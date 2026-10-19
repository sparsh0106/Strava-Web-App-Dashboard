package com.example.ride_sync

import android.app.DatePickerDialog
import android.content.Context
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.entries.ExerciseLocation
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val SYNC_URL = "https://sparshrides.vercel.app/api/sync/samsung"
private const val RIDES_PER_UPLOAD = 20
private const val ROUTE_POINTS_PER_UPLOAD = 50_000

private data class RoutePoint(
    val timestamp: Instant,
    val latitude: Double,
    val longitude: Double,
    val altitudeMeters: Double?
)

private data class RideRecord(
    val sourceRecordId: String,
    val fingerprint: String,
    val activityType: String,
    val title: String?,
    val comment: String?,
    val startTime: Instant,
    val endTime: Instant,
    val durationSeconds: Double,
    val elapsedSeconds: Double,
    val distanceMeters: Double?,
    val elevationGainMeters: Double?,
    val caloriesKcal: Double?,
    val meanSpeedMetersPerSecond: Double?,
    val maxSpeedMetersPerSecond: Double?,
    val meanHeartRateBpm: Double?,
    val maxHeartRateBpm: Double?,
    val bikeName: String?,
    val routePoints: List<RoutePoint>
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            val context = LocalContext.current
            val dateFormatter = remember { DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault()) }
            var fromDate by remember { mutableStateOf(LocalDate.now().minusYears(5)) }
            var toDate by remember { mutableStateOf(LocalDate.now()) }
            var rides by remember { mutableStateOf<List<RideRecord>>(emptyList()) }
            var syncToken by remember { mutableStateOf(SyncTokenVault.read(context)) }
            var status by remember { mutableStateOf("Choose a date range, then fetch your rides.") }
            var fetching by remember { mutableStateOf(false) }
            var syncing by remember { mutableStateOf(false) }
            var showToken by remember { mutableStateOf(false) }

            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("RideScope Sync", style = MaterialTheme.typography.headlineMedium)
                        Text("Fetch cycling sessions from Samsung Health and sync them to your RideScope dashboard.")
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("PRIVATE UPLOAD", style = MaterialTheme.typography.labelLarge)
                                Text("Your sync token is encrypted on this phone. Ride summaries and available GPS points are sent over HTTPS to RideScope when you tap Sync.")
                            }
                        }

                        Text("DATE RANGE", style = MaterialTheme.typography.labelLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(
                                onClick = {
                                    DatePickerDialog(
                                        context,
                                        { _, year, month, day -> fromDate = LocalDate.of(year, month + 1, day) },
                                        fromDate.year,
                                        fromDate.monthValue - 1,
                                        fromDate.dayOfMonth
                                    ).show()
                                },
                                modifier = Modifier.weight(1f)
                            ) { Text("From ${fromDate.format(dateFormatter)}") }
                            OutlinedButton(
                                onClick = {
                                    DatePickerDialog(
                                        context,
                                        { _, year, month, day -> toDate = LocalDate.of(year, month + 1, day) },
                                        toDate.year,
                                        toDate.monthValue - 1,
                                        toDate.dayOfMonth
                                    ).show()
                                },
                                modifier = Modifier.weight(1f)
                            ) { Text("To ${toDate.format(dateFormatter)}") }
                        }

                        Button(
                            onClick = {
                                if (fromDate.isAfter(toDate)) {
                                    status = "The start date must be on or before the end date."
                                } else {
                                    fetching = true
                                    rides = emptyList()
                                    status = "Connecting to Samsung Health…"
                                    lifecycleScope.launch {
                                        try {
                                            rides = readCyclingRides(fromDate, toDate)
                                            val pointCount = rides.sumOf { it.routePoints.size }
                                            status = if (rides.isEmpty()) {
                                                "No cycling sessions found for this date range."
                                            } else {
                                                "${rides.size} rides fetched · $pointCount GPS points available"
                                            }
                                        } catch (error: Exception) {
                                            if (error is ResolvablePlatformException && error.hasResolution) {
                                                runCatching { error.resolve(this@MainActivity) }
                                            }
                                            status = error.message ?: "Could not read Samsung Health data. Check Samsung Health setup and permissions."
                                            rides = emptyList()
                                        } finally {
                                            fetching = false
                                        }
                                    }
                                }
                            },
                            enabled = !fetching && !syncing,
                            modifier = Modifier.fillMaxWidth()
                        ) { Text(if (fetching) "Fetching rides…" else "Fetch rides") }

                        Text(status, style = MaterialTheme.typography.titleMedium)

                        rides.forEach { ride ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(ride.title ?: readableType(ride.activityType), style = MaterialTheme.typography.titleMedium)
                                    Text("${ride.startTime.atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("EEE, d MMM yyyy · HH:mm", Locale.getDefault()))} · ${formatDuration(ride.durationSeconds)}")
                                    val distance = ride.distanceMeters?.let { String.format(Locale.getDefault(), "%.2f km", it / 1000.0) } ?: "Distance unavailable"
                                    val route = if (ride.routePoints.isEmpty()) "No GPS route" else "${ride.routePoints.size} GPS points"
                                    Text("$distance · $route")
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(4.dp))
                        Text("SYNC CREDENTIAL", style = MaterialTheme.typography.labelLarge)
                        OutlinedTextField(
                            value = syncToken,
                            onValueChange = { syncToken = it },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            label = { Text("RideScope sync token") },
                            visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                            supportingText = { Text("Set SYNC_TOKEN in the RideScope Vercel project, then paste the same value here.") }
                        )
                        OutlinedButton(
                            onClick = { showToken = !showToken },
                            enabled = syncToken.isNotEmpty(),
                            modifier = Modifier.fillMaxWidth()
                        ) { Text(if (showToken) "Hide token" else "Show token") }
                        Button(
                            onClick = {
                                if (syncToken.isBlank()) {
                                    status = "Enter the sync token configured for RideScope first."
                                } else if (rides.isEmpty()) {
                                    status = "Fetch rides before syncing."
                                } else {
                                    SyncTokenVault.save(context, syncToken.trim())
                                    syncing = true
                                    lifecycleScope.launch {
                                        try {
                                            val batches = uploadBatches(rides)
                                            var syncedRides = 0
                                            var syncedPoints = 0
                                            batches.forEachIndexed { index, batch ->
                                                status = "Syncing batch ${index + 1} of ${batches.size}…"
                                                val result = withContext(Dispatchers.IO) {
                                                    uploadBatch(syncToken.trim(), batch)
                                                }
                                                syncedRides += result.first
                                                syncedPoints += result.second
                                            }
                                            status = "$syncedRides rides synced · $syncedPoints GPS points stored in Neon"
                                        } catch (error: Exception) {
                                            status = error.message ?: "Sync failed. Retry; completed batches are safe to send again."
                                        } finally {
                                            syncing = false
                                        }
                                    }
                                }
                            },
                            enabled = !fetching && !syncing && rides.isNotEmpty(),
                            modifier = Modifier.fillMaxWidth()
                        ) { Text(if (syncing) "Syncing…" else "Sync ${rides.size} rides to RideScope") }
                    }
                }
            }
        }
    }

    private suspend fun readCyclingRides(fromDate: LocalDate, toDate: LocalDate): List<RideRecord> {
        val store = HealthDataService.getStore(applicationContext)
        val exercisePermission = Permission.of(DataTypes.EXERCISE, AccessType.READ)
        val exercisePermissions = setOf(exercisePermission)
        var granted = store.getGrantedPermissions(exercisePermissions)
        if (!granted.containsAll(exercisePermissions)) {
            granted = store.requestPermissions(exercisePermissions, this@MainActivity)
        }
        if (!granted.contains(exercisePermission)) throw IllegalStateException("Exercise read permission was not granted.")

        val locationPermission = Permission.of(DataTypes.EXERCISE_LOCATION, AccessType.READ)
        val locationPermissions = setOf(locationPermission)
        val canReadRoutes = try {
            var locations = store.getGrantedPermissions(locationPermissions)
            if (!locations.containsAll(locationPermissions)) {
                locations = store.requestPermissions(locationPermissions, this@MainActivity)
            }
            locations.contains(locationPermission)
        } catch (_: Exception) {
            false
        }

        val request = DataTypes.EXERCISE.readDataRequestBuilder
            .setLocalTimeFilter(LocalTimeFilter.of(fromDate.atStartOfDay(), toDate.plusDays(1).atStartOfDay()))
            .setOrdering(com.samsung.android.sdk.health.data.request.Ordering.DESC)
            .setLimit(1000)
            .build()
        val points = store.readData(request).dataList
        val cyclingTypes = setOf(
            DataType.ExerciseType.PredefinedExerciseType.BIKING,
            DataType.ExerciseType.PredefinedExerciseType.MOUNTAIN_BIKING,
            DataType.ExerciseType.PredefinedExerciseType.STATIONARY_BIKING
        )
        val unique = linkedMapOf<String, RideRecord>()
        points.forEach { point ->
            val sessions = point.getValue(DataType.ExerciseType.SESSIONS).orEmpty()
            sessions.forEachIndexed { index, session ->
                if (session.exerciseType in cyclingTypes) {
                    val ride = toRide(point.uid, index, session, canReadRoutes)
                    unique[ride.sourceRecordId] = ride
                }
            }
        }
        return unique.values.sortedByDescending { it.startTime }
    }

    private fun toRide(recordId: String, index: Int, session: ExerciseSession, includeRoute: Boolean): RideRecord {
        val routePoints = if (includeRoute) {
            session.route.orEmpty().sortedBy { it.timestamp }.mapNotNull { it.toRoutePointOrNull() }
        } else emptyList()
        val duration = session.duration.toMillis().coerceAtLeast(0).toDouble() / 1000.0
        val elapsed = Duration.between(session.startTime, session.endTime).toMillis().coerceAtLeast(0).toDouble() / 1000.0
        val activityType = session.exerciseType.toString()
        val fingerprintInput = listOf(
            activityType,
            session.startTime.toString(),
            session.endTime.toString(),
            finiteDouble(session.distance)?.toString().orEmpty(),
            session.duration.toMillis().toString()
        ).joinToString("|")
        return RideRecord(
            sourceRecordId = "$recordId/session/$index",
            fingerprint = sha256(fingerprintInput),
            activityType = activityType,
            title = session.customTitle?.takeIf { it.isNotBlank() },
            comment = session.comment?.takeIf { it.isNotBlank() },
            startTime = session.startTime,
            endTime = session.endTime,
            durationSeconds = duration,
            elapsedSeconds = elapsed,
            distanceMeters = finiteDouble(session.distance),
            elevationGainMeters = finiteDouble(session.altitudeGain),
            caloriesKcal = finiteDouble(session.calories),
            meanSpeedMetersPerSecond = finiteDouble(session.meanSpeed),
            maxSpeedMetersPerSecond = finiteDouble(session.maxSpeed),
            meanHeartRateBpm = finiteDouble(session.meanHeartRate),
            maxHeartRateBpm = finiteDouble(session.maxHeartRate),
            bikeName = null,
            routePoints = routePoints
        )
    }

    private fun ExerciseLocation.toRoutePointOrNull(): RoutePoint? {
        if (!latitude.isFinite() || !longitude.isFinite()) return null
        return RoutePoint(timestamp, latitude.toDouble(), longitude.toDouble(), finiteDouble(altitude))
    }

    private fun uploadBatch(token: String, rides: List<RideRecord>): Pair<Int, Int> {
        val connection = (URL(SYNC_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 90_000
            doOutput = true
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
        }
        try {
            val payload = syncPayload(rides).toByteArray(StandardCharsets.UTF_8)
            connection.setFixedLengthStreamingMode(payload.size)
            connection.outputStream.use { it.write(payload) }
            val statusCode = connection.responseCode
            val responseStream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
            val responseText = responseStream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (statusCode !in 200..299) {
                val detail = runCatching { JSONObject(responseText).optString("error") }.getOrNull().orEmpty()
                throw IOException(detail.ifBlank { "RideScope rejected the upload (HTTP $statusCode)." })
            }
            val response = JSONObject(responseText)
            if (!response.optBoolean("ok")) throw IOException("RideScope did not confirm the sync.")
            return response.optInt("ridesSynced") to response.optInt("routePointsSynced")
        } finally {
            connection.disconnect()
        }
    }

    private fun uploadBatches(records: List<RideRecord>): List<List<RideRecord>> {
        val batches = mutableListOf<List<RideRecord>>()
        var current = mutableListOf<RideRecord>()
        var currentPointCount = 0
        records.forEach { ride ->
            if (ride.routePoints.size > ROUTE_POINTS_PER_UPLOAD) {
                throw IllegalStateException("A ride has too many GPS points to upload in one request.")
            }
            if (current.isNotEmpty() &&
                (current.size >= RIDES_PER_UPLOAD || currentPointCount + ride.routePoints.size > ROUTE_POINTS_PER_UPLOAD)
            ) {
                batches.add(current)
                current = mutableListOf()
                currentPointCount = 0
            }
            current.add(ride)
            currentPointCount += ride.routePoints.size
        }
        if (current.isNotEmpty()) batches.add(current)
        return batches
    }

    private fun syncPayload(records: List<RideRecord>): String = JSONObject().apply {
        put("schemaVersion", 1)
        put("source", "Samsung Health")
        put("timezone", ZoneId.systemDefault().id)
        put("exportedAt", Instant.now().toString())
        put("rides", JSONArray().apply {
            records.forEach { ride ->
                put(JSONObject().apply {
                    put("sourceRecordId", ride.sourceRecordId)
                    put("fingerprint", ride.fingerprint)
                    put("activityType", ride.activityType)
                    putNullable(this, "title", ride.title)
                    putNullable(this, "comment", ride.comment)
                    put("startTime", ride.startTime.toString())
                    put("endTime", ride.endTime.toString())
                    put("durationSeconds", ride.durationSeconds)
                    put("elapsedSeconds", ride.elapsedSeconds)
                    put("movingTimeSeconds", JSONObject.NULL)
                    putNullable(this, "distanceMeters", ride.distanceMeters)
                    putNullable(this, "elevationGainMeters", ride.elevationGainMeters)
                    putNullable(this, "caloriesKcal", ride.caloriesKcal)
                    putNullable(this, "meanSpeedMetersPerSecond", ride.meanSpeedMetersPerSecond)
                    putNullable(this, "maxSpeedMetersPerSecond", ride.maxSpeedMetersPerSecond)
                    putNullable(this, "meanHeartRateBpm", ride.meanHeartRateBpm)
                    putNullable(this, "maxHeartRateBpm", ride.maxHeartRateBpm)
                    putNullable(this, "bikeName", ride.bikeName)
                    put("routePoints", JSONArray().apply {
                        ride.routePoints.forEachIndexed { index, point ->
                            put(JSONObject().apply {
                                put("sequence", index)
                                put("timestamp", point.timestamp.toString())
                                put("latitude", point.latitude)
                                put("longitude", point.longitude)
                                putNullable(this, "altitudeMeters", point.altitudeMeters)
                            })
                        }
                    })
                })
            }
        })
    }.toString()

    private fun finiteDouble(value: Float?): Double? = value?.takeIf { it.isFinite() }?.toDouble()

    private fun putNullable(json: JSONObject, key: String, value: Any?) {
        json.put(key, value ?: JSONObject.NULL)
    }

    private fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun formatDuration(seconds: Double): String {
        val total = seconds.toLong()
        val hours = total / 3600
        val minutes = (total % 3600) / 60
        return if (hours > 0) "$hours h ${minutes.toString().padStart(2, '0')} min" else "$minutes min"
    }

    private fun readableType(value: String): String = value.lowercase(Locale.getDefault())
        .replace('_', ' ')
        .replaceFirstChar { it.titlecase(Locale.getDefault()) }
}

private object SyncTokenVault {
    private const val PREFS = "ridescope_sync_credentials"
    private const val PREF_TOKEN = "encrypted_sync_token"
    private const val KEY_ALIAS = "ridescope_sync_token_v1"
    private const val ANDROID_KEY_STORE = "AndroidKeyStore"

    fun read(context: Context): String {
        val encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_TOKEN, null)
            ?: return ""
        return runCatching {
            val packed = Base64.getDecoder().decode(encoded)
            val ivLength = packed.first().toInt() and 0xff
            require(ivLength in 12..16 && packed.size > ivLength + 1)
            val iv = packed.copyOfRange(1, ivLength + 1)
            val ciphertext = packed.copyOfRange(ivLength + 1, packed.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
        }.getOrElse {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PREF_TOKEN).apply()
            ""
        }
    }

    fun save(context: Context, token: String) {
        if (token.isBlank()) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PREF_TOKEN).apply()
            return
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(token.toByteArray(StandardCharsets.UTF_8))
        val packed = byteArrayOf(iv.size.toByte()) + iv + ciphertext
        val encoded = Base64.getEncoder().encodeToString(packed)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_TOKEN, encoded).apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }
}
