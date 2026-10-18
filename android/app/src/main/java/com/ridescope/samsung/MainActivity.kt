package com.ridescope.samsung

import android.app.Activity
import android.app.DatePickerDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import com.samsung.android.sdk.health.data.DataType
import com.samsung.android.sdk.health.data.DataTypes
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.entries.ExerciseLocation
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private const val REQUEST_JSON = 41
private const val REQUEST_CSV = 42
private const val DEFAULT_RANGE_YEARS = 5

data class RoutePoint(
    val timestamp: Instant,
    val latitude: Double,
    val longitude: Double,
    val altitudeMeters: Double?
)

data class RideRecord(
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
    val route: List<RoutePoint>
)

class MainActivity : Activity() {
    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var fromDate = LocalDate.now().minusYears(DEFAULT_RANGE_YEARS)
    private var toDate = LocalDate.now()
    private var fetchedFromDate = fromDate
    private var fetchedToDate = toDate
    private var rides: List<RideRecord> = emptyList()
    private lateinit var content: LinearLayout
    private lateinit var statusView: TextView
    private lateinit var fromButton: Button
    private lateinit var toButton: Button
    private lateinit var fetchButton: Button
    private lateinit var jsonButton: Button
    private lateinit var csvButton: Button
    private lateinit var ridesContainer: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildScreen()
    }

    override fun onDestroy() {
        activityScope.cancel()
        super.onDestroy()
    }

    private fun buildScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(247, 246, 242))
        }
        val scroll = ScrollView(this)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(28), dp(22), dp(32))
        }
        scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        content.addView(label("RIDESCOPE  /  SAMSUNG HEALTH", 12, Color.rgb(185, 64, 47), true))
        content.addView(space(8))
        content.addView(label("Bring your rides over.", 30, Color.rgb(43, 39, 36), true))
        content.addView(space(8))
        content.addView(label(
            "Read cycling sessions from Samsung Health, review the details, and save an export on this device.",
            16,
            Color.rgb(102, 96, 89)
        ))
        content.addView(space(18))

        val privacyCard = card()
        privacyCard.addView(label("LOCAL EXPORT ONLY", 12, Color.rgb(185, 64, 47), true))
        privacyCard.addView(space(5))
        privacyCard.addView(label(
            "Nothing is uploaded. GPS points are included only in the JSON file you choose to save. Manage access in Samsung Health settings.",
            14,
            Color.rgb(78, 73, 69)
        ))
        content.addView(privacyCard)

        content.addView(space(20))
        content.addView(label("DATE RANGE", 12, Color.rgb(111, 104, 96), true))
        content.addView(space(8))
        val dateRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fromButton = secondaryButton("")
        toButton = secondaryButton("")
        dateRow.addView(fromButton, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginEnd = dp(8) })
        dateRow.addView(toButton, LinearLayout.LayoutParams(0, dp(48), 1f).apply { marginStart = dp(8) })
        content.addView(dateRow)
        fromButton.setOnClickListener { chooseDate(true) }
        toButton.setOnClickListener { chooseDate(false) }
        updateDateButtons()

        content.addView(space(12))
        fetchButton = primaryButton("Fetch rides")
        fetchButton.setOnClickListener { fetchRides() }
        content.addView(fetchButton, LinearLayout.LayoutParams(-1, dp(52)))
        content.addView(space(10))
        statusView = label("Choose a date range, then fetch your cycling sessions.", 14, Color.rgb(102, 96, 89))
        content.addView(statusView)

        content.addView(space(20))
        ridesContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(ridesContainer)

        content.addView(space(16))
        content.addView(label("EXPORT THE PREVIEW", 12, Color.rgb(111, 104, 96), true))
        content.addView(space(8))
        jsonButton = secondaryButton("Save JSON with route points")
        jsonButton.isEnabled = false
        jsonButton.setOnClickListener { createExport(REQUEST_JSON) }
        content.addView(jsonButton, LinearLayout.LayoutParams(-1, dp(48)))
        content.addView(space(8))
        csvButton = secondaryButton("Save CSV summary")
        csvButton.isEnabled = false
        csvButton.setOnClickListener { createExport(REQUEST_CSV) }
        content.addView(csvButton, LinearLayout.LayoutParams(-1, dp(48)))

        setContentView(root)
    }

    private fun chooseDate(start: Boolean) {
        val selected = if (start) fromDate else toDate
        DatePickerDialog(
            this,
            { _, year, month, day ->
                val picked = LocalDate.of(year, month + 1, day)
                if (start) fromDate = picked else toDate = picked
                updateDateButtons()
            },
            selected.year,
            selected.monthValue - 1,
            selected.dayOfMonth
        ).show()
    }

    private fun updateDateButtons() {
        val formatter = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault())
        fromButton.text = "From  " + fromDate.format(formatter)
        toButton.text = "To  " + toDate.format(formatter)
    }

    private fun fetchRides() {
        if (fromDate.isAfter(toDate)) {
            statusView.text = "The start date must be on or before the end date."
            return
        }
        fetchButton.isEnabled = false
        fromButton.isEnabled = false
        toButton.isEnabled = false
        jsonButton.isEnabled = false
        csvButton.isEnabled = false
        statusView.text = "Connecting to Samsung Health…"

        activityScope.launch {
            try {
                val store = HealthDataService.getStore(applicationContext)
                val exercisePermission = Permission.of(DataTypes.EXERCISE, AccessType.READ)
                val exercisePermissions = setOf(exercisePermission)
                var granted = store.getGrantedPermissions(exercisePermissions)
                if (!granted.containsAll(exercisePermissions)) {
                    granted = store.requestPermissions(exercisePermissions, this@MainActivity)
                }
                if (!granted.contains(exercisePermission)) {
                    throw IllegalStateException("Exercise read permission was not granted.")
                }

                val routePermission = Permission.of(DataTypes.EXERCISE_LOCATION, AccessType.READ)
                val routePermissions = setOf(routePermission)
                val routeAccessGranted = try {
                    var locationGrants = store.getGrantedPermissions(routePermissions)
                    if (!locationGrants.containsAll(routePermissions)) {
                        locationGrants = store.requestPermissions(routePermissions, this@MainActivity)
                    }
                    locationGrants.contains(routePermission)
                } catch (_: Exception) {
                    false
                }

                statusView.text = if (routeAccessGranted) {
                    "Reading rides and available GPS points…"
                } else {
                    "Reading ride summaries. Route permission was not granted."
                }
                val start = fromDate.atStartOfDay()
                val endExclusive = toDate.plusDays(1).atStartOfDay()
                val request = DataTypes.EXERCISE.readDataRequestBuilder
                    .setLocalTimeFilter(LocalTimeFilter.of(start, endExclusive))
                    .build()
                val points = store.readData(request).dataList
                val found = buildList {
                    points.forEach { point ->
                        val sessions = point.getValue(DataType.ExerciseType.SESSIONS).orEmpty()
                        sessions.forEachIndexed { index, session ->
                            if (session.exerciseType.toString() in CYCLING_TYPES) {
                                add(toRide(point.uid, index, session, routeAccessGranted))
                            }
                        }
                    }
                }.sortedByDescending { it.startTime }
                rides = found
                fetchedFromDate = fromDate
                fetchedToDate = toDate
                renderRides()
                val routes = rides.count { it.route.isNotEmpty() }
                statusView.text = if (rides.isEmpty()) {
                    "No cycling sessions found for this date range."
                } else if (routeAccessGranted) {
                    rides.size.toString() + " rides found · " + routes + " with GPS points"
                } else {
                    rides.size.toString() + " rides found · summaries only"
                }
                jsonButton.isEnabled = rides.isNotEmpty()
                csvButton.isEnabled = rides.isNotEmpty()
            } catch (error: Exception) {
                if (error is ResolvablePlatformException && error.hasResolution) {
                    runCatching { error.resolve(this@MainActivity) }
                }
                statusView.text = error.message
                    ?: "Could not read Samsung Health data. Check Samsung Health setup and permissions."
                rides = emptyList()
                renderRides()
            } finally {
                fetchButton.isEnabled = true
                fromButton.isEnabled = true
                toButton.isEnabled = true
            }
        }
    }

    private fun toRide(
        recordId: String,
        sessionIndex: Int,
        session: ExerciseSession,
        includeRoute: Boolean
    ): RideRecord {
        val route = if (includeRoute) {
            session.route.orEmpty()
                .sortedBy { it.timestamp }
                .mapNotNull { it.toRoutePointOrNull() }
        } else {
            emptyList()
        }
        val durationSeconds = session.duration.toMillis().coerceAtLeast(0).toDouble() / 1000.0
        val elapsedSeconds = Duration.between(session.startTime, session.endTime).toMillis()
            .coerceAtLeast(0).toDouble() / 1000.0
        val type = session.exerciseType.toString()
        val stableId = recordId + "/session/" + sessionIndex
        val fingerprintInput = listOf(
            type,
            session.startTime.toString(),
            session.endTime.toString(),
            finiteDouble(session.distance)?.toString().orEmpty(),
            session.duration.toMillis().toString()
        ).joinToString("|")
        return RideRecord(
            sourceRecordId = stableId,
            fingerprint = sha256(fingerprintInput),
            activityType = type,
            title = session.customTitle?.takeIf { it.isNotBlank() },
            comment = session.comment?.takeIf { it.isNotBlank() },
            startTime = session.startTime,
            endTime = session.endTime,
            durationSeconds = durationSeconds,
            elapsedSeconds = elapsedSeconds,
            distanceMeters = finiteDouble(session.distance),
            elevationGainMeters = finiteDouble(session.altitudeGain),
            caloriesKcal = finiteDouble(session.calories),
            meanSpeedMetersPerSecond = finiteDouble(session.meanSpeed),
            maxSpeedMetersPerSecond = finiteDouble(session.maxSpeed),
            meanHeartRateBpm = finiteDouble(session.meanHeartRate),
            maxHeartRateBpm = finiteDouble(session.maxHeartRate),
            route = route
        )
    }

    private fun ExerciseLocation.toRoutePointOrNull(): RoutePoint? {
        if (!latitude.isFinite() || !longitude.isFinite()) return null
        return RoutePoint(
            timestamp = timestamp,
            latitude = latitude.toDouble(),
            longitude = longitude.toDouble(),
            altitudeMeters = finiteDouble(altitude)
        )
    }

    private fun finiteDouble(value: Float?): Double? =
        value?.takeIf { it.isFinite() }?.toDouble()

    private fun renderRides() {
        ridesContainer.removeAllViews()
        if (rides.isEmpty()) return
        rides.forEachIndexed { index, ride ->
            val item = card()
            val activityName = ride.activityType.lowercase(Locale.getDefault())
                .replace('_', ' ')
                .replaceFirstChar { it.uppercase(Locale.getDefault()) }
            item.addView(label(ride.title ?: activityName, 18, Color.rgb(43, 39, 36), true))
            item.addView(space(4))
            val date = DateTimeFormatter.ofPattern("EEE, d MMM yyyy · HH:mm", Locale.getDefault())
                .withZone(ZoneId.systemDefault())
                .format(ride.startTime)
            val finishTime = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())
                .withZone(ZoneId.systemDefault())
                .format(ride.endTime)
            item.addView(label(date + " – " + finishTime, 14, Color.rgb(102, 96, 89)))
            item.addView(space(7))
            val distance = ride.distanceMeters?.let {
                String.format(Locale.getDefault(), "%.2f km", it / 1000.0)
            } ?: "Distance unavailable"
            val duration = formatDuration(ride.durationSeconds)
            val climb = ride.elevationGainMeters?.let {
                String.format(Locale.getDefault(), "%.0f m climb", it)
            } ?: "Climb unavailable"
            val speed = ride.meanSpeedMetersPerSecond?.let {
                String.format(Locale.getDefault(), "%.1f km/h average", it * 3.6)
            } ?: "Average speed unavailable"
            val heartRate = ride.meanHeartRateBpm?.let {
                String.format(Locale.getDefault(), "%.0f bpm average", it)
            } ?: "Heart rate unavailable"
            val routeStatus = if (ride.route.isEmpty()) "No route" else ride.route.size.toString() + " GPS points"
            item.addView(label(
                listOf(distance, duration, climb, speed, heartRate, routeStatus).joinToString("  ·  "),
                14,
                Color.rgb(67, 62, 58)
            ))
            ridesContainer.addView(item, LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = if (index == 0) 0 else dp(10)
            })
        }
    }

    private fun createExport(requestCode: Int) {
        if (rides.isEmpty()) return
        val extension = if (requestCode == REQUEST_JSON) "json" else "csv"
        val mime = if (requestCode == REQUEST_JSON) "application/json" else "text/csv"
        val formatter = DateTimeFormatter.ofPattern("yyyyMMdd")
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
            putExtra(Intent.EXTRA_TITLE, "ridescope-samsung-" + LocalDate.now().format(formatter) + "." + extension)
        }
        startActivityForResult(intent, requestCode)
    }

    @Deprecated("Use the document picker result to write the selected export.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_JSON && requestCode != REQUEST_CSV) return
        if (resultCode != Activity.RESULT_OK || data?.data == null) return
        val uri = data.data!!
        val exportRides = rides.toList()
        val exportFrom = fetchedFromDate
        val exportTo = fetchedToDate
        activityScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri)?.use { stream ->
                        OutputStreamWriter(stream, StandardCharsets.UTF_8).use { writer ->
                            val output = if (requestCode == REQUEST_JSON) {
                                jsonExport(exportRides, exportFrom, exportTo)
                            } else {
                                csvExport(exportRides)
                            }
                            writer.write(output)
                        }
                    } ?: throw IllegalStateException("Could not open the selected file.")
                }
                Toast.makeText(this@MainActivity, "Export saved.", Toast.LENGTH_LONG).show()
            } catch (error: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    error.message ?: "Could not save the export.",
                    Toast.LENGTH_LONG
                ).show()
            }
        }
    }

    private fun jsonExport(records: List<RideRecord>, from: LocalDate, to: LocalDate): String {
        val root = JSONObject()
        root.put("schemaVersion", 1)
        root.put("source", "Samsung Health")
        root.put("exportedAt", Instant.now().toString())
        root.put("dateRange", JSONObject().apply {
            put("from", from.toString())
            put("to", to.toString())
            put("timezone", ZoneId.systemDefault().id)
        })
        root.put("containsExactGpsRoutes", records.any { it.route.isNotEmpty() })
        root.put("routeCoordinatesAreUnmodified", true)
        root.put("uploaded", false)
        root.put("rides", JSONArray().apply {
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
                    put("routePoints", JSONArray().apply {
                        ride.route.forEachIndexed { pointIndex, point ->
                            put(JSONObject().apply {
                                put("sequence", pointIndex)
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
        return root.toString(2)
    }

    private fun csvExport(records: List<RideRecord>): String {
        val headers = listOf(
            "source_record_id",
            "fingerprint",
            "activity_type",
            "title",
            "comment",
            "start_time",
            "end_time",
            "duration_seconds",
            "elapsed_seconds",
            "moving_time_seconds",
            "distance_meters",
            "elevation_gain_meters",
            "calories_kcal",
            "mean_speed_meters_per_second",
            "max_speed_meters_per_second",
            "mean_heart_rate_bpm",
            "max_heart_rate_bpm",
            "route_point_count"
        )
        val rows = records.map { ride ->
            listOf(
                ride.sourceRecordId,
                ride.fingerprint,
                ride.activityType,
                ride.title.orEmpty(),
                ride.comment.orEmpty(),
                ride.startTime.toString(),
                ride.endTime.toString(),
                ride.durationSeconds.toString(),
                ride.elapsedSeconds.toString(),
                "",
                ride.distanceMeters?.toString().orEmpty(),
                ride.elevationGainMeters?.toString().orEmpty(),
                ride.caloriesKcal?.toString().orEmpty(),
                ride.meanSpeedMetersPerSecond?.toString().orEmpty(),
                ride.maxSpeedMetersPerSecond?.toString().orEmpty(),
                ride.meanHeartRateBpm?.toString().orEmpty(),
                ride.maxHeartRateBpm?.toString().orEmpty(),
                ride.route.size.toString()
            )
        }
        return (listOf(headers) + rows)
            .joinToString("\r\n") { row -> row.joinToString(",") { csvCell(it) } }
    }

    private fun csvCell(value: String): String = "\"" + value.replace("\"", "\"\"") + "\""

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
        return if (hours > 0) String.format(Locale.getDefault(), "%d h %02d min", hours, minutes)
        else String.format(Locale.getDefault(), "%d min", minutes)
    }

    private fun card(): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(14), dp(16), dp(14))
        background = rounded(Color.WHITE, dp(18), Color.rgb(234, 230, 223))
    }

    private fun label(
        value: String,
        sizeSp: Int,
        color: Int,
        bold: Boolean = false
    ): TextView = TextView(this).apply {
        text = value
        textSize = sizeSp.toFloat()
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        gravity = Gravity.CENTER_VERTICAL
    }

    private fun primaryButton(value: String): Button = Button(this).apply {
        text = value
        isAllCaps = false
        textSize = 16f
        setTextColor(Color.WHITE)
        background = rounded(Color.rgb(195, 60, 46), dp(15))
    }

    private fun secondaryButton(value: String): Button = Button(this).apply {
        text = value
        isAllCaps = false
        textSize = 14f
        setTextColor(Color.rgb(58, 53, 49))
        background = rounded(Color.WHITE, dp(14), Color.rgb(226, 221, 213))
    }

    private fun rounded(fill: Int, radius: Int, stroke: Int? = null) =
        GradientDrawable().apply {
            setColor(fill)
            cornerRadius = radius.toFloat()
            if (stroke != null) setStroke(dp(1), stroke)
        }

    private fun space(height: Int): View = View(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(height))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private val CYCLING_TYPES = setOf("BIKING", "MOUNTAIN_BIKING", "STATIONARY_BIKING")
    }
}
