package com.example.ride_sync

import android.content.Context
import androidx.activity.ComponentActivity
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.entries.ExerciseLocation
import com.samsung.android.sdk.health.data.data.entries.ExerciseLog
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

private const val SYNC_URL = "https://sparshrides.vercel.app/api/sync/samsung"
private const val ROUTE_SYNC_URL = "https://sparshrides.vercel.app/api/sync/samsung/routes"
private const val RIDES_PER_UPLOAD = 20
private const val SAMPLES_PER_UPLOAD = 8_000
private const val DEVICE_NAME = "Watch"
private const val BIKE_NAME = "Fuji"

internal data class RoutePoint(
    val timestamp: Instant,
    val latitude: Double,
    val longitude: Double,
    val altitudeMeters: Double?,
    val sequence: Int
)

internal data class ExerciseSample(
    val timestamp: Instant,
    val heartRateBpm: Double?,
    val cadenceRpm: Double?,
    val powerWatts: Double?,
    val speedMetersPerSecond: Double?,
    val sequence: Int
)

internal data class RideRecord(
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
    val routePoints: List<RoutePoint>,
    val exerciseSamples: List<ExerciseSample>,
    val replaceRoutePoints: Boolean = true,
    val replaceExerciseSamples: Boolean = true
)

internal fun RideRecord.isSameSessionAs(other: RideRecord): Boolean {
    if (activityType != other.activityType) return false
    val startDifference = kotlin.math.abs(startTime.epochSecond - other.startTime.epochSecond)
    if (startDifference > 120) return false

    val thisDistance = distanceMeters
    val otherDistance = other.distanceMeters
    if (thisDistance != null && otherDistance != null) {
        val toleranceMeters = maxOf(25.0, maxOf(thisDistance, otherDistance) * 0.001)
        return kotlin.math.abs(thisDistance - otherDistance) <= toleranceMeters
    }
    return fingerprint == other.fingerprint
}

internal fun RideRecord.mergeDuplicate(other: RideRecord): RideRecord {
    val preferred = listOf(this, other).maxWith(
        compareBy<RideRecord> { it.routePoints.size + it.exerciseSamples.size }
            .thenBy {
                listOf(
                    it.title,
                    it.comment,
                    it.distanceMeters,
                    it.elevationGainMeters,
                    it.caloriesKcal,
                    it.meanSpeedMetersPerSecond,
                    it.maxSpeedMetersPerSecond,
                    it.meanHeartRateBpm,
                    it.maxHeartRateBpm
                ).count { value -> value != null }
            }
            .thenBy { it.fingerprint }
    )
    val fallback = if (preferred === this) other else this
    val mergedRoute = (routePoints + other.routePoints)
        .distinctBy { Triple(it.timestamp, it.latitude, it.longitude) }
        .sortedBy { it.timestamp }
        .mapIndexed { index, point -> point.copy(sequence = index) }
    val mergedSamples = (exerciseSamples + other.exerciseSamples)
        .distinctBy { Triple(it.timestamp, it.heartRateBpm, it.speedMetersPerSecond) }
        .sortedBy { it.timestamp }
        .mapIndexed { index, sample -> sample.copy(sequence = index) }

    return preferred.copy(
        sourceRecordId = minOf(sourceRecordId, other.sourceRecordId),
        title = preferred.title ?: fallback.title,
        comment = preferred.comment ?: fallback.comment,
        distanceMeters = preferred.distanceMeters ?: fallback.distanceMeters,
        elevationGainMeters = preferred.elevationGainMeters ?: fallback.elevationGainMeters,
        caloriesKcal = preferred.caloriesKcal ?: fallback.caloriesKcal,
        meanSpeedMetersPerSecond = preferred.meanSpeedMetersPerSecond ?: fallback.meanSpeedMetersPerSecond,
        maxSpeedMetersPerSecond = preferred.maxSpeedMetersPerSecond ?: fallback.maxSpeedMetersPerSecond,
        meanHeartRateBpm = preferred.meanHeartRateBpm ?: fallback.meanHeartRateBpm,
        maxHeartRateBpm = preferred.maxHeartRateBpm ?: fallback.maxHeartRateBpm,
        bikeName = preferred.bikeName ?: fallback.bikeName,
        routePoints = mergedRoute,
        exerciseSamples = mergedSamples
    )
}

internal data class SyncResult(val rides: Int, val routePoints: Int, val exerciseSamples: Int)

internal data class RouteSyncResult(
    val linkedSourceRecordIds: Set<String>,
    val unmatchedSourceRecordIds: Set<String>,
    val ambiguousSourceRecordIds: Set<String>,
    val existingRouteSourceRecordIds: Set<String>,
    val routePoints: Int
)

private data class RouteBatchResult(
    val matches: List<Pair<String, String>>,
    val routePoints: Int
)

internal class SyncHttpException(val statusCode: Int, message: String) : IOException(message)

internal object SamsungRideSyncEngine {
    suspend fun readCyclingRides(
        context: Context,
        fromDate: LocalDate,
        toDate: LocalDate,
        permissionActivity: ComponentActivity? = null
    ): List<RideRecord> {
        val store = HealthDataService.getStore(context.applicationContext)
        val exercisePermission = Permission.of(DataTypes.EXERCISE, AccessType.READ)
        val exercisePermissions = setOf(exercisePermission)
        var granted = store.getGrantedPermissions(exercisePermissions)
        if (!granted.containsAll(exercisePermissions)) {
            val activity = permissionActivity
                ?: throw IllegalStateException("Open RideScope Sync to grant Samsung Health exercise access.")
            granted = store.requestPermissions(exercisePermissions, activity)
        }
        if (!granted.contains(exercisePermission)) {
            throw IllegalStateException("Samsung Health exercise read permission was not granted.")
        }

        val locationPermission = Permission.of(DataTypes.EXERCISE_LOCATION, AccessType.READ)
        val locationPermissions = setOf(locationPermission)
        val canReadRoutes = runCatching {
            var locations = store.getGrantedPermissions(locationPermissions)
            if (!locations.containsAll(locationPermissions) && permissionActivity != null) {
                locations = store.requestPermissions(locationPermissions, permissionActivity)
            }
            locations.contains(locationPermission)
        }.getOrDefault(false)

        val points = readExerciseWindow(store, fromDate, toDate)
        val cyclingTypes = setOf(
            DataType.ExerciseType.PredefinedExerciseType.BIKING,
            DataType.ExerciseType.PredefinedExerciseType.MOUNTAIN_BIKING,
            DataType.ExerciseType.PredefinedExerciseType.STATIONARY_BIKING
        )
        val unique = mutableListOf<RideRecord>()
        points.forEach { point ->
            point.getValue(DataType.ExerciseType.SESSIONS).orEmpty().forEachIndexed { index, session ->
                if (session.exerciseType in cyclingTypes) {
                    val ride = session.toRide(point.uid, index, canReadRoutes)
                    val duplicateIndex = unique.indexOfFirst { it.isSameSessionAs(ride) }
                    if (duplicateIndex < 0) unique.add(ride)
                    else unique[duplicateIndex] = unique[duplicateIndex].mergeDuplicate(ride)
                }
            }
        }
        return unique.sortedByDescending { it.startTime }
    }

    private suspend fun readExerciseWindow(
        store: com.samsung.android.sdk.health.data.HealthDataStore,
        fromDate: LocalDate,
        toDate: LocalDate
    ): List<com.samsung.android.sdk.health.data.data.HealthDataPoint> {
        val request = DataTypes.EXERCISE.readDataRequestBuilder
            .setLocalTimeFilter(LocalTimeFilter.of(fromDate.atStartOfDay(), toDate.plusDays(1).atStartOfDay()))
            .setOrdering(com.samsung.android.sdk.health.data.request.Ordering.DESC)
            .setLimit(1000)
            .build()
        val data = store.readData(request).dataList
        if (data.size < 1000 || fromDate >= toDate) return data

        // Samsung's read limit returns only the first 1000 rows. Split full
        // date ranges so the one-time history backfill does not silently omit
        // older workouts when a broad request hits that cap.
        val midpoint = fromDate.plusDays(java.time.temporal.ChronoUnit.DAYS.between(fromDate, toDate) / 2)
        return readExerciseWindow(store, fromDate, midpoint) +
            readExerciseWindow(store, midpoint.plusDays(1), toDate)
    }

    fun sync(token: String, rides: List<RideRecord>): SyncResult {
        val batches = uploadBatches(rides)
        var syncedRides = 0
        var syncedPoints = 0
        var syncedSamples = 0
        batches.forEach { batch ->
            val result = uploadBatch(token, batch)
            syncedRides += result.first
            syncedPoints += result.second
            syncedSamples += result.third
        }
        return SyncResult(syncedRides, syncedPoints, syncedSamples)
    }

    /** Upload route geometry only, attaching it to a uniquely matched existing RideScope ride. */
    fun syncRoutes(token: String, rides: List<RideRecord>): RouteSyncResult {
        val routeRides = rides.filter { it.routePoints.isNotEmpty() }.map {
            it.copy(exerciseSamples = emptyList(), replaceExerciseSamples = false)
        }
        val linked = linkedSetOf<String>()
        val unmatched = linkedSetOf<String>()
        val ambiguous = linkedSetOf<String>()
        val existingRoute = linkedSetOf<String>()
        var syncedPoints = 0

        uploadBatches(routeRides).forEach { batch ->
            val result = uploadRouteBatch(token, batch)
            syncedPoints += result.routePoints
            result.matches.forEach { (sourceRecordId, status) ->
                when (status) {
                    "linked" -> linked.add(sourceRecordId)
                    "unmatched" -> unmatched.add(sourceRecordId)
                    "ambiguous" -> ambiguous.add(sourceRecordId)
                    "existing_route" -> existingRoute.add(sourceRecordId)
                }
            }
        }
        return RouteSyncResult(linked, unmatched, ambiguous, existingRoute, syncedPoints)
    }

    private fun ExerciseSession.toRide(recordId: String, index: Int, includeRoute: Boolean): RideRecord {
        val routePoints = if (includeRoute) {
            route.orEmpty().sortedBy { it.timestamp }.mapIndexedNotNull { index, location -> location.toRoutePointOrNull(index) }
        } else emptyList()
        val samples = log.orEmpty().sortedBy { it.timestamp }.mapIndexed { index, entry -> entry.toExerciseSample(index) }
        val duration = this.duration.toMillis().coerceAtLeast(0).toDouble() / 1000.0
        val elapsed = Duration.between(this.startTime, this.endTime).toMillis().coerceAtLeast(0).toDouble() / 1000.0
        val type = this.exerciseType.toString()
        val fingerprintInput = listOf(
            type,
            this.startTime.toString(),
            this.endTime.toString(),
            finiteDouble(this.distance)?.toString().orEmpty(),
            duration.toString()
        ).joinToString("|")
        return RideRecord(
            sourceRecordId = "$recordId/session/$index",
            fingerprint = sha256(fingerprintInput),
            activityType = type,
            title = this.customTitle?.takeIf { it.isNotBlank() },
            comment = this.comment?.takeIf { it.isNotBlank() },
            startTime = this.startTime,
            endTime = this.endTime,
            durationSeconds = duration,
            elapsedSeconds = elapsed,
            distanceMeters = finiteDouble(this.distance),
            elevationGainMeters = finiteDouble(this.altitudeGain),
            caloriesKcal = finiteDouble(this.calories),
            meanSpeedMetersPerSecond = finiteDouble(this.meanSpeed),
            maxSpeedMetersPerSecond = finiteDouble(this.maxSpeed),
            meanHeartRateBpm = finiteDouble(this.meanHeartRate),
            maxHeartRateBpm = finiteDouble(this.maxHeartRate),
            bikeName = BIKE_NAME,
            routePoints = routePoints,
            exerciseSamples = samples
        )
    }

    private fun ExerciseLocation.toRoutePointOrNull(sequence: Int): RoutePoint? {
        if (!latitude.isFinite() || !longitude.isFinite()) return null
        return RoutePoint(timestamp, latitude.toDouble(), longitude.toDouble(), finiteDouble(altitude), sequence)
    }

    private fun ExerciseLog.toExerciseSample(sequence: Int) = ExerciseSample(
        timestamp = timestamp,
        heartRateBpm = finiteDouble(heartRate),
        cadenceRpm = finiteDouble(cadence),
        powerWatts = finiteDouble(power),
        speedMetersPerSecond = finiteDouble(speed),
        sequence = sequence
    )

    private fun uploadBatch(token: String, rides: List<RideRecord>): Triple<Int, Int, Int> {
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
                val message = detail.ifBlank {
                    if (statusCode == 404) {
                        "RideScope's upload endpoint was not found (HTTP 404). Redeploy the latest server code."
                    } else {
                        "RideScope rejected the upload (HTTP $statusCode)."
                    }
                }
                throw SyncHttpException(statusCode, message)
            }
            val response = JSONObject(responseText)
            if (!response.optBoolean("ok")) throw IOException("RideScope did not confirm the sync.")
            return Triple(
                response.optInt("ridesSynced"),
                response.optInt("routePointsSynced"),
                response.optInt("exerciseSamplesSynced")
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun uploadRouteBatch(token: String, rides: List<RideRecord>): RouteBatchResult {
        val connection = (URL(ROUTE_SYNC_URL).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20_000
            readTimeout = 90_000
            doOutput = true
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
        }
        try {
            val payload = routeSyncPayload(rides).toByteArray(StandardCharsets.UTF_8)
            connection.setFixedLengthStreamingMode(payload.size)
            connection.outputStream.use { it.write(payload) }
            val statusCode = connection.responseCode
            val responseStream = if (statusCode in 200..299) connection.inputStream else connection.errorStream
            val responseText = responseStream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (statusCode !in 200..299) {
                val detail = runCatching { JSONObject(responseText).optString("error") }.getOrNull().orEmpty()
                val message = detail.ifBlank {
                    if (statusCode == 404) {
                        "RideScope's GPS-only upload endpoint was not found (HTTP 404). Redeploy the latest server code."
                    } else {
                        "RideScope rejected the GPS-only upload (HTTP $statusCode)."
                    }
                }
                throw SyncHttpException(statusCode, message)
            }
            val response = JSONObject(responseText)
            if (!response.optBoolean("ok")) throw IOException("RideScope did not confirm the GPS route sync.")
            val matches = buildList {
                val entries = response.optJSONArray("matches") ?: JSONArray()
                for (index in 0 until entries.length()) {
                    val entry = entries.optJSONObject(index) ?: continue
                    add(entry.optString("sourceRecordId") to entry.optString("status"))
                }
            }
            return RouteBatchResult(matches, response.optInt("routePointsSynced"))
        } finally {
            connection.disconnect()
        }
    }

    private fun uploadBatches(records: List<RideRecord>): List<List<RideRecord>> {
        val batches = mutableListOf<List<RideRecord>>()
        var current = mutableListOf<RideRecord>()
        var currentPointCount = 0
        records.flatMap(::splitRideForUpload).forEach { ride ->
            val rideSampleCount = ride.routePoints.size + ride.exerciseSamples.size
            if (current.isNotEmpty() &&
                (current.size >= RIDES_PER_UPLOAD || currentPointCount + rideSampleCount > SAMPLES_PER_UPLOAD)
            ) {
                batches.add(current)
                current = mutableListOf()
                currentPointCount = 0
            }
            current.add(ride)
            currentPointCount += rideSampleCount
        }
        if (current.isNotEmpty()) batches.add(current)
        return batches
    }

    private fun splitRideForUpload(ride: RideRecord): List<RideRecord> {
        if (ride.routePoints.size + ride.exerciseSamples.size <= SAMPLES_PER_UPLOAD) return listOf(ride)
        val chunks = mutableListOf<RideRecord>()
        var routeOffset = 0
        var sampleOffset = 0
        var replaceRoute = true
        var replaceSamples = true
        while (routeOffset < ride.routePoints.size || sampleOffset < ride.exerciseSamples.size) {
            var remaining = SAMPLES_PER_UPLOAD
            val routeEnd = minOf(routeOffset + remaining, ride.routePoints.size)
            val routeChunk = ride.routePoints.subList(routeOffset, routeEnd)
            routeOffset = routeEnd
            remaining -= routeChunk.size
            val sampleEnd = minOf(sampleOffset + remaining, ride.exerciseSamples.size)
            val sampleChunk = ride.exerciseSamples.subList(sampleOffset, sampleEnd)
            sampleOffset = sampleEnd
            chunks += ride.copy(
                routePoints = routeChunk,
                exerciseSamples = sampleChunk,
                replaceRoutePoints = replaceRoute && routeChunk.isNotEmpty(),
                replaceExerciseSamples = replaceSamples && sampleChunk.isNotEmpty()
            )
            if (routeChunk.isNotEmpty()) replaceRoute = false
            if (sampleChunk.isNotEmpty()) replaceSamples = false
        }
        return chunks
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
                    put("movingTimeSeconds", ride.durationSeconds)
                    put("deviceName", DEVICE_NAME)
                    putNullable(this, "distanceMeters", ride.distanceMeters)
                    putNullable(this, "elevationGainMeters", ride.elevationGainMeters)
                    putNullable(this, "caloriesKcal", ride.caloriesKcal)
                    putNullable(this, "meanSpeedMetersPerSecond", ride.meanSpeedMetersPerSecond)
                    putNullable(this, "maxSpeedMetersPerSecond", ride.maxSpeedMetersPerSecond)
                    putNullable(this, "meanHeartRateBpm", ride.meanHeartRateBpm)
                    putNullable(this, "maxHeartRateBpm", ride.maxHeartRateBpm)
                    putNullable(this, "bikeName", ride.bikeName)
                    put("routePoints", JSONArray().apply {
                        ride.routePoints.forEach { point ->
                            put(JSONObject().apply {
                                put("sequence", point.sequence)
                                put("timestamp", point.timestamp.toString())
                                put("latitude", point.latitude)
                                put("longitude", point.longitude)
                                putNullable(this, "altitudeMeters", point.altitudeMeters)
                            })
                        }
                    })
                    put("replaceRoutePoints", ride.replaceRoutePoints)
                    put("replaceExerciseSamples", ride.replaceExerciseSamples)
                    put("exerciseSamples", JSONArray().apply {
                        ride.exerciseSamples.forEach { sample ->
                            put(JSONObject().apply {
                                put("sequence", sample.sequence)
                                put("timestamp", sample.timestamp.toString())
                                putNullable(this, "heartRateBpm", sample.heartRateBpm)
                                putNullable(this, "cadenceRpm", sample.cadenceRpm)
                                putNullable(this, "powerWatts", sample.powerWatts)
                                putNullable(this, "speedMetersPerSecond", sample.speedMetersPerSecond)
                            })
                        }
                    })
                })
            }
        })
    }.toString()

    private fun routeSyncPayload(records: List<RideRecord>): String = JSONObject().apply {
        put("schemaVersion", 1)
        put("timezone", ZoneId.systemDefault().id)
        put("rides", JSONArray().apply {
            records.forEach { ride ->
                put(JSONObject().apply {
                    put("sourceRecordId", ride.sourceRecordId)
                    put("startTime", ride.startTime.toString())
                    // Distance is used only to identify an existing database ride; the route-only
                    // endpoint never writes it or changes any ride summary fields.
                    putNullable(this, "distanceMeters", ride.distanceMeters)
                    put("replaceRoutePoints", ride.replaceRoutePoints)
                    put("routePoints", JSONArray().apply {
                        ride.routePoints.forEach { point ->
                            put(JSONObject().apply {
                                put("sequence", point.sequence)
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

    private fun finiteDouble(value: Number?): Double? = value?.toDouble()?.takeIf { it.isFinite() }

    private fun putNullable(json: JSONObject, key: String, value: Any?) {
        json.put(key, value ?: JSONObject.NULL)
    }

    private fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(StandardCharsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
