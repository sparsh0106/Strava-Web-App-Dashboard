package com.example.ride_sync

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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (AutoSyncState.isEnabled(this) && AutoSyncState.hasBaseline(this)) {
            AutoRideSyncScheduler.start(this)
        }

        setContent {
            val context = LocalContext.current
            val dateFormatter = remember {
                DateTimeFormatter.ofPattern("EEE, d MMM yyyy · HH:mm", Locale.getDefault())
            }
            var rides by remember { mutableStateOf<List<RideRecord>>(emptyList()) }
            var syncToken by remember { mutableStateOf(SyncTokenVault.read(context)) }
            var autoSyncEnabled by remember { mutableStateOf(AutoSyncState.isEnabled(context)) }
            var status by remember {
                mutableStateOf(
                    AutoSyncState.lastStatus(context).ifBlank {
                        "Enable automatic sync to watch for new rides. Existing rides will be skipped."
                    }
                )
            }
            var working by remember { mutableStateOf(false) }
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
                        Text("New Samsung Health cycling rides sync to RideScope automatically.")

                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("BACKGROUND SYNC", style = MaterialTheme.typography.labelLarge)
                                Text("When enabled, RideScope checks Samsung Health about every 15 minutes and uploads new rides only. Android may delay background checks to save battery.")
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(if (autoSyncEnabled) "Automatic sync is on" else "Automatic sync is off")
                                    Switch(
                                        checked = autoSyncEnabled,
                                        enabled = !working,
                                        onCheckedChange = { enabled ->
                                            if (!enabled) {
                                                AutoSyncState.setEnabled(context, false)
                                                AutoRideSyncScheduler.stop(context)
                                                autoSyncEnabled = false
                                                status = "Automatic sync is off."
                                                AutoSyncState.setStatus(context, status)
                                            } else if (syncToken.isBlank()) {
                                                status = "Enter the RideScope sync token before enabling automatic sync."
                                            } else {
                                                working = true
                                                SyncTokenVault.save(context, syncToken.trim())
                                                status = "Checking existing rides so only future additions sync…"
                                                lifecycleScope.launch {
                                                    try {
                                                        if (!AutoSyncState.hasBaseline(context)) {
                                                            val today = LocalDate.now()
                                                            val existing = SamsungRideSyncEngine.readCyclingRides(
                                                                context,
                                                                today.minusDays(AUTO_SYNC_LOOKBACK_DAYS),
                                                                today,
                                                                this@MainActivity
                                                            )
                                                            AutoSyncState.establishBaseline(context, existing)
                                                        }
                                                        AutoSyncState.setEnabled(context, true)
                                                        AutoRideSyncScheduler.start(context)
                                                        autoSyncEnabled = true
                                                        status = "Automatic sync is on. Existing rides were skipped; new rides will be checked about every 15 minutes."
                                                        AutoSyncState.setStatus(context, status)
                                                    } catch (error: Exception) {
                                                        resolveSamsungError(error)
                                                        status = error.message ?: "Could not enable automatic sync. Check Samsung Health access."
                                                        AutoSyncState.setStatus(context, status)
                                                    } finally {
                                                        working = false
                                                    }
                                                }
                                            }
                                        }
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(2.dp))
                        Text("SYNC CREDENTIAL", style = MaterialTheme.typography.labelLarge)
                        OutlinedTextField(
                            value = syncToken,
                            onValueChange = {
                                syncToken = it
                                if (autoSyncEnabled) SyncTokenVault.save(context, it.trim())
                            },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            label = { Text("RideScope sync token") },
                            visualTransformation = if (showToken) VisualTransformation.None else PasswordVisualTransformation(),
                            supportingText = { Text("Use the same SYNC_TOKEN configured in the RideScope Vercel project.") }
                        )
                        OutlinedButton(
                            onClick = { showToken = !showToken },
                            enabled = syncToken.isNotEmpty(),
                            modifier = Modifier.fillMaxWidth()
                        ) { Text(if (showToken) "Hide token" else "Show token") }

                        Button(
                            onClick = {
                                if (syncToken.isBlank()) {
                                    status = "Enter the RideScope sync token first."
                                } else if (!AutoSyncState.hasBaseline(context)) {
                                    status = "Enable automatic sync once to mark existing rides as already known."
                                } else {
                                    working = true
                                    rides = emptyList()
                                    SyncTokenVault.save(context, syncToken.trim())
                                    status = "Checking Samsung Health for new rides…"
                                    lifecycleScope.launch {
                                        try {
                                            val today = LocalDate.now()
                                            val recentRides = SamsungRideSyncEngine.readCyclingRides(
                                                context,
                                                today.minusDays(AUTO_SYNC_LOOKBACK_DAYS),
                                                today,
                                                this@MainActivity
                                            )
                                            rides = AutoSyncState.unseenRides(context, recentRides)
                                            if (rides.isEmpty()) {
                                                status = "No new rides found."
                                            } else {
                                                val result = withContext(Dispatchers.IO) {
                                                    SamsungRideSyncEngine.sync(syncToken.trim(), rides)
                                                }
                                                AutoSyncState.markSynced(context, rides)
                                                status = "${result.rides} new rides synced · ${result.routePoints} GPS points saved to Neon."
                                            }
                                            AutoSyncState.setStatus(context, status)
                                        } catch (error: Exception) {
                                            resolveSamsungError(error)
                                            status = error.message ?: "Could not check Samsung Health. Try again."
                                            AutoSyncState.setStatus(context, status)
                                        } finally {
                                            working = false
                                        }
                                    }
                                }
                            },
                            enabled = !working,
                            modifier = Modifier.fillMaxWidth()
                        ) { Text(if (working) "Checking rides…" else "Check for new rides now") }

                        Card(modifier = Modifier.fillMaxWidth()) {
                            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("PRIVATE UPLOAD", style = MaterialTheme.typography.labelLarge)
                                Text("Your sync token is encrypted on this phone. Only rides not seen before are uploaded over HTTPS. New rides include summaries and any available GPS points.")
                            }
                        }

                        Text(status, style = MaterialTheme.typography.titleMedium)

                        rides.forEach { ride ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(ride.title ?: readableType(ride.activityType), style = MaterialTheme.typography.titleMedium)
                                    Text("${ride.startTime.atZone(ZoneId.systemDefault()).format(dateFormatter)} · ${formatDuration(ride.durationSeconds)}")
                                    val distance = ride.distanceMeters?.let {
                                        String.format(Locale.getDefault(), "%.2f km", it / 1000.0)
                                    } ?: "Distance unavailable"
                                    val route = if (ride.routePoints.isEmpty()) "No GPS route" else "${ride.routePoints.size} GPS points"
                                    Text("$distance · $route")
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private fun resolveSamsungError(error: Exception) {
        if (error is ResolvablePlatformException && error.hasResolution) {
            runCatching { error.resolve(this@MainActivity) }
        }
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

internal object SyncTokenVault {
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
