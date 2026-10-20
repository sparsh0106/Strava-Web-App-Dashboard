package com.example.ride_sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.IOException
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

internal const val AUTO_SYNC_INTERVAL_MINUTES = 15L
internal const val AUTO_SYNC_LOOKBACK_DAYS = 30L

internal object AutoSyncState {
    private const val PREFS = "ridescope_auto_sync"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_BASELINE_DONE = "baseline_done"
    private const val KEY_BASELINE_VERSION = "baseline_version"
    private const val MANUAL_ONLY_BASELINE_VERSION = 2
    private const val KEY_TODAY_BASELINE_RECOVERY_DONE = "today_baseline_recovery_done"
    private const val KEY_KNOWN_RIDES = "known_rides"
    private const val KEY_STATUS = "last_status"
    private const val MAX_KNOWN_RIDES = 5000

    private data class KnownRide(
        val activityType: String,
        val startEpochSecond: Long,
        val distanceMeters: Double?,
        val fingerprint: String
    ) {
        fun matches(ride: RideRecord): Boolean {
            if (activityType != ride.activityType) return false
            if (kotlin.math.abs(startEpochSecond - ride.startTime.epochSecond) > 120) return false
            val knownDistance = distanceMeters
            val rideDistance = ride.distanceMeters
            if (knownDistance != null && rideDistance != null) {
                val tolerance = maxOf(25.0, maxOf(knownDistance, rideDistance) * 0.001)
                return kotlin.math.abs(knownDistance - rideDistance) <= tolerance
            }
            return fingerprint == ride.fingerprint
        }
    }

    fun isEnabled(context: Context): Boolean = preferences(context).getBoolean(KEY_ENABLED, false)

    fun setEnabled(context: Context, enabled: Boolean) {
        preferences(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
    }

    fun hasBaseline(context: Context): Boolean = preferences(context).getBoolean(KEY_BASELINE_DONE, false)

    fun needsManualOnlyBaselineRefresh(context: Context): Boolean =
        preferences(context).getInt(KEY_BASELINE_VERSION, 0) < MANUAL_ONLY_BASELINE_VERSION

    fun lastStatus(context: Context): String = preferences(context).getString(KEY_STATUS, "").orEmpty()

    fun setStatus(context: Context, status: String) {
        preferences(context).edit().putString(KEY_STATUS, status).apply()
    }

    fun establishBaseline(context: Context, rides: List<RideRecord>) {
        // A baseline is meant to skip history. Keep today's workouts eligible so
        // enabling sync after a ride cannot silently classify that ride as old.
        val today = LocalDate.now()
        writeKnownRides(
            context,
            rides.filterNot { it.autoDetected == true }
                .filter { it.startTime.atZone(java.time.ZoneId.systemDefault()).toLocalDate().isBefore(today) }
                .map(::identity)
        )
        preferences(context).edit()
            .putBoolean(KEY_BASELINE_DONE, true)
            .putInt(KEY_BASELINE_VERSION, MANUAL_ONLY_BASELINE_VERSION)
            .apply()
    }

    fun recoverTodayFromLegacyBaseline(context: Context) {
        val prefs = preferences(context)
        if (prefs.getBoolean(KEY_TODAY_BASELINE_RECOVERY_DONE, false)) return

        // Earlier builds stored the baseline and successfully uploaded rides in
        // one list. Remove today's entries once so rides skipped by that baseline
        // get another chance. Server upserts make a retry of an already-uploaded
        // ride safe and idempotent.
        val today = LocalDate.now()
        val retained = readKnownRides(context).filter {
            java.time.Instant.ofEpochSecond(it.startEpochSecond)
                .atZone(java.time.ZoneId.systemDefault())
                .toLocalDate()
                .isBefore(today)
        }
        writeKnownRides(context, retained)
        prefs.edit().putBoolean(KEY_TODAY_BASELINE_RECOVERY_DONE, true).commit()
    }

    fun unseenRides(context: Context, rides: List<RideRecord>): List<RideRecord> {
        val known = readKnownRides(context)
        return rides.filterNot { it.autoDetected == true }
            .filter { ride -> known.none { it.matches(ride) } }
    }

    fun markSynced(context: Context, rides: List<RideRecord>) {
        val known = readKnownRides(context).toMutableList()
        rides.forEach { ride ->
            if (known.none { it.matches(ride) }) known.add(identity(ride))
        }
        writeKnownRides(context, known)
    }

    private fun identity(ride: RideRecord) = KnownRide(
        activityType = ride.activityType,
        startEpochSecond = ride.startTime.epochSecond,
        distanceMeters = ride.distanceMeters,
        fingerprint = ride.fingerprint
    )

    private fun readKnownRides(context: Context): List<KnownRide> = runCatching {
        val saved = preferences(context).getString(KEY_KNOWN_RIDES, "[]") ?: "[]"
        val array = JSONArray(saved)
        buildList {
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val distance = if (item.isNull("distanceMeters")) null else item.optDouble("distanceMeters")
                val fingerprint = item.optString("fingerprint")
                val activityType = item.optString("activityType")
                if (activityType.isBlank() || fingerprint.isBlank()) continue
                add(
                    KnownRide(
                        activityType = activityType,
                        startEpochSecond = item.optLong("startEpochSecond"),
                        distanceMeters = distance?.takeIf { it.isFinite() },
                        fingerprint = fingerprint
                    )
                )
            }
        }
    }.getOrDefault(emptyList())

    private fun writeKnownRides(context: Context, rides: List<KnownRide>) {
        val array = JSONArray()
        rides.sortedByDescending { it.startEpochSecond }
            .distinctBy { "${it.activityType}|${it.startEpochSecond}|${it.distanceMeters}|${it.fingerprint}" }
            .take(MAX_KNOWN_RIDES)
            .forEach { ride ->
                array.put(JSONObject().apply {
                    put("activityType", ride.activityType)
                    put("startEpochSecond", ride.startEpochSecond)
                    put("distanceMeters", ride.distanceMeters ?: JSONObject.NULL)
                    put("fingerprint", ride.fingerprint)
                })
            }
        preferences(context).edit().putString(KEY_KNOWN_RIDES, array.toString()).apply()
    }

    private fun preferences(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

internal object AutoRideSyncScheduler {
    private const val PERIODIC_WORK_NAME = "ridescope-periodic-samsung-sync"
    private const val IMMEDIATE_WORK_NAME = "ridescope-immediate-samsung-sync"

    private fun constraints() = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun start(context: Context) {
        val request = PeriodicWorkRequestBuilder<SamsungRideSyncWorker>(
            AUTO_SYNC_INTERVAL_MINUTES,
            TimeUnit.MINUTES
        ).setConstraints(constraints()).build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
        enqueueImmediate(context)
    }

    fun enqueueImmediate(context: Context) {
        val request = OneTimeWorkRequestBuilder<SamsungRideSyncWorker>()
            .setConstraints(constraints())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            IMMEDIATE_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request
        )
    }

    fun stop(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME)
        WorkManager.getInstance(context).cancelUniqueWork(IMMEDIATE_WORK_NAME)
    }
}

class SamsungRideSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!AutoSyncState.isEnabled(applicationContext)) return Result.success()
        if (!AutoSyncState.hasBaseline(applicationContext)) {
            AutoSyncState.setStatus(applicationContext, "Open RideScope Sync to finish automatic sync setup.")
            return Result.success()
        }
        AutoSyncState.recoverTodayFromLegacyBaseline(applicationContext)

        val token = SyncTokenVault.read(applicationContext)
        if (token.isBlank()) {
            AutoSyncState.setStatus(applicationContext, "Automatic sync needs the RideScope sync token.")
            return Result.success()
        }

        return try {
            val today = LocalDate.now()
            val rides = SamsungRideSyncEngine.readCyclingRides(
                applicationContext,
                today.minusDays(AUTO_SYNC_LOOKBACK_DAYS),
                today
            )
            if (AutoSyncState.needsManualOnlyBaselineRefresh(applicationContext)) {
                AutoSyncState.establishBaseline(applicationContext, rides)
            }
            val newRides = AutoSyncState.unseenRides(applicationContext, rides)
            if (newRides.isEmpty()) {
                AutoSyncState.setStatus(
                    applicationContext,
                    "Automatic sync is on · checked ${rides.count { it.autoDetected != true }} manual rides · ignored ${rides.count { it.autoDetected == true }} auto-detected rides · no new rides found."
                )
                Result.success()
            } else {
                val result = withContext(Dispatchers.IO) {
                    SamsungRideSyncEngine.sync(token, newRides)
                }
                AutoSyncState.markSynced(applicationContext, newRides)
                AutoSyncState.setStatus(
                    applicationContext,
                    "Auto-synced ${result.rides} new manual rides · ignored ${rides.count { it.autoDetected == true }} auto-detected rides · ${result.routePoints} GPS points."
                )
                Result.success()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            AutoSyncState.setStatus(
                applicationContext,
                error.message ?: "Automatic sync failed. It will try again."
            )
            when {
                error is SyncHttpException && (error.statusCode == 408 || error.statusCode == 429 || error.statusCode >= 500) -> Result.retry()
                error is IOException && error !is SyncHttpException -> Result.retry()
                else -> Result.success()
            }
        }
    }
}
