package com.example.ride_sync

import android.content.Context
import androidx.activity.ComponentActivity
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.entries.ExerciseLocation
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
private const val RIDES_PER_UPLOAD = 20
private const val ROUTE_POINTS_PER_UPLOAD = 50_000
private const val DEVICE_NAME = "Watch"
private const val BIKE_NAME = "Fuji"

internal data class RoutePoint(
    val timestamp: Instant,
    val latitude: Double,
    val longitude: Double,
    val altitudeMeters: Double?
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
    val routePoints: List<RoutePoint>
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
        compareBy<RideRecord> { it.routePoints.size }
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
        routePoints = mergedRoute
    )
}

internal data class SyncResult(val rides: Int, val routePoints: Int)

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

    fun sync(token: String, rides: List<RideRecord>): SyncResult {
        val batches = uploadBatches(rides)
        var syncedRides = 0
        var syncedPoints = 0
        batches.forEach { batch ->
            val result = uploadBatch(token, batch)
            syncedRides += result.first
            syncedPoints += result.second
        }
        return SyncResult(syncedRides, syncedPoints)
    }

    private fun ExerciseSession.toRide(recordId: String, index: Int, includeRoute: Boolean): RideRecord {
        val routePoints = if (includeRoute) {
            route.orEmpty().sortedBy { it.timestamp }.mapNotNull { it.toRoutePointOrNull() }
        } else emptyList()
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
}
