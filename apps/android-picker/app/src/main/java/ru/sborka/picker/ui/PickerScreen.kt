package ru.sborka.picker.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.sborka.picker.data.PickType
import ru.sborka.picker.data.PickerItem
import ru.sborka.picker.data.PickerSettings
import ru.sborka.picker.data.VoiceSource
import ru.sborka.picker.domain.VoiceCommand

private val Forest = Color(0xFF153E35)
private val Cream = Color(0xFFF7F1E3)
private val Amber = Color(0xFFF1B457)
private val Red = Color(0xFF9B3A2A)
private val Blue = Color(0xFF315F7D)

@Composable
fun PickerApp(
    state: PickerUiState,
    onLogin: (String, String) -> Unit,
    onLogout: () -> Unit,
    onRefresh: () -> Unit,
    onCommand: (VoiceCommand) -> Unit,
    onSettings: (PickerSettings) -> Unit,
) {
    MaterialTheme {
        when {
            state.checkingSession -> LoadingScreen()
            !state.loggedIn -> LoginScreen(state.busy, state.message, onLogin)
            state.completed -> CompletedScreen(state.workerName, state.message, onRefresh, onLogout)
            state.current != null -> CurrentItemScreen(state, onCommand, onSettings, onLogout)
            else -> LoadingScreen()
        }
    }
}

@Composable
fun LoadingScreen() {
    Box(Modifier.fillMaxSize().background(Forest), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            CircularProgressIndicator(color = Amber)
            Spacer(Modifier.height(18.dp))
            Text("Открываем смену…", color = Cream, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun LoginScreen(
    busy: Boolean,
    message: String,
    onLogin: (String, String) -> Unit,
) {
    var login by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Box(
        Modifier.fillMaxSize().background(Forest).padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Card(
            modifier = Modifier.fillMaxWidth().testTag("login-screen"),
            shape = RoundedCornerShape(28.dp),
            colors = CardDefaults.cardColors(containerColor = Cream),
        ) {
            Column(Modifier.padding(28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("СБОРКА ЗАКАЗОВ", color = Red, fontSize = 12.sp, fontWeight = FontWeight.Black)
                Text("Начать смену", color = Forest, fontSize = 38.sp, fontWeight = FontWeight.Black)
                Text("Только личная очередь сборщика", color = Forest.copy(alpha = 0.68f), fontSize = 16.sp)
                OutlinedTextField(
                    value = login,
                    onValueChange = { login = it },
                    modifier = Modifier.fillMaxWidth().testTag("login-input"),
                    label = { Text("Логин") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth().testTag("password-input"),
                    label = { Text("Пароль") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                )
                if (message.isNotBlank()) {
                    Text(message, color = Red, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("login-message"))
                }
                Button(
                    onClick = { onLogin(login, password) },
                    enabled = !busy && login.isNotBlank() && password.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().height(62.dp).testTag("login-button"),
                    colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Forest),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text(if (busy) "ВХОДИМ…" else "ВОЙТИ", fontSize = 19.sp, fontWeight = FontWeight.Black)
                }
            }
        }
    }
}

@Composable
fun CompletedScreen(workerName: String, message: String, onRefresh: () -> Unit, onLogout: () -> Unit) {
    Box(
        Modifier.fillMaxSize().background(Forest).padding(24.dp).testTag("completed-screen"),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Box(
                Modifier.size(96.dp).background(Amber, RoundedCornerShape(28.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Text("✓", color = Forest, fontSize = 58.sp, fontWeight = FontWeight.Black)
            }
            Text("Ваша часть заказа собрана.", color = Cream, fontSize = 38.sp, lineHeight = 42.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
            Text(workerName, color = Cream.copy(alpha = 0.72f), fontSize = 17.sp)
            if (message.isNotBlank()) Text(message, color = Amber)
            Button(
                onClick = onRefresh,
                modifier = Modifier.fillMaxWidth().height(64.dp).testTag("refresh-button"),
                colors = ButtonDefaults.buttonColors(containerColor = Amber, contentColor = Forest),
            ) { Text("ОБНОВИТЬ", fontWeight = FontWeight.Black, fontSize = 18.sp) }
            OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().height(54.dp)) {
                Text("Завершить смену", color = Cream)
            }
        }
    }
}

@Composable
fun CurrentItemScreen(
    state: PickerUiState,
    onCommand: (VoiceCommand) -> Unit,
    onSettings: (PickerSettings) -> Unit,
    onLogout: () -> Unit,
) {
    val item = requireNotNull(state.current)
    Scaffold(
        modifier = Modifier.testTag("current-item-screen"),
        containerColor = Cream,
        topBar = { PickerTopBar(state.workerName, state.progressLabel, state.remaining, onLogout) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { ItemCard(item) }
            if (state.paused) item { PauseCard { onCommand(VoiceCommand.CONTINUE) } }
            if (state.message.isNotBlank()) item { StatusMessage(state.message) }
            item { ActionButtons(state.busy || state.paused, onCommand) }
            item { SettingsCard(state.settings, state.alenaAvailable, onSettings) }
            item { Spacer(Modifier.height(18.dp)) }
        }
    }
}

@Composable
private fun PickerTopBar(workerName: String, progress: String, remaining: Int, onLogout: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Forest).padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Column {
            Text(workerName, color = Cream, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text("Осталось: $remaining", color = Cream.copy(alpha = 0.7f), fontSize = 13.sp)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(progress, color = Amber, fontSize = 21.sp, fontWeight = FontWeight.Black)
            Text("Выйти", color = Cream, fontSize = 13.sp, modifier = Modifier.testTag("logout-button"))
        }
        Box(Modifier.size(52.dp).testTag("logout-hitbox")) {
            OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxSize(), contentPadding = ButtonDefaults.ContentPadding) {
                Text("×", color = Cream, fontSize = 25.sp)
            }
        }
    }
}

@Composable
fun ItemCard(item: PickerItem) {
    val isPiece = item.pickType == PickType.PIECE
    val typeLabel = when (item.pickType) {
        PickType.PACKAGE -> "БЛОК"
        PickType.PIECE -> "ШТУЧНЫЙ"
        PickType.REVIEW -> "ПРОВЕРИТЬ"
    }
    Card(
        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).testTag("current-item"),
        shape = RoundedCornerShape(24.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(item.groupKey, color = Red, fontSize = 12.sp, fontWeight = FontWeight.Black)
                Text(typeLabel, color = if (isPiece) Red else Blue, fontSize = 13.sp, fontWeight = FontWeight.Black)
            }
            Text(item.name, color = Forest, fontSize = 31.sp, lineHeight = 35.sp, fontWeight = FontWeight.Black)
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Text(formatQuantity(item.pickQuantity), color = if (isPiece) Red else Blue, fontSize = 72.sp, lineHeight = 74.sp, fontWeight = FontWeight.Black)
                Text(if (isPiece) "ШТ" else "БЛОКА", color = Forest.copy(alpha = 0.6f), fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 12.dp))
            }
            Text("Штрихкод: ${item.barcode ?: "—"}", color = Forest.copy(alpha = 0.55f), fontSize = 13.sp)
        }
    }
}

@Composable
private fun PauseCard(onContinue: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFE5B8)), shape = RoundedCornerShape(18.dp)) {
        Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("ПАУЗА", color = Red, fontSize = 28.sp, fontWeight = FontWeight.Black)
            Text("Рабочие команды отключены. Скажите «Продолжить».", color = Forest, textAlign = TextAlign.Center)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onContinue, modifier = Modifier.fillMaxWidth().height(58.dp)) {
                Text("ПРОДОЛЖИТЬ", fontWeight = FontWeight.Black)
            }
        }
    }
}

@Composable
private fun StatusMessage(message: String) {
    Text(
        message,
        modifier = Modifier.fillMaxWidth().background(Color(0xFFF5DDD5), RoundedCornerShape(12.dp)).padding(14.dp).testTag("status-message"),
        color = Red,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun ActionButtons(disabled: Boolean, onCommand: (VoiceCommand) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(
            onClick = { onCommand(VoiceCommand.PICKED) },
            enabled = !disabled,
            modifier = Modifier.fillMaxWidth().height(78.dp).testTag("picked-button"),
            shape = RoundedCornerShape(16.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Forest, contentColor = Cream),
        ) { Text("ВЗЯЛ", fontSize = 28.sp, fontWeight = FontWeight.Black) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GloveButton("ПОВТОРИ", Modifier.weight(1f), disabled) { onCommand(VoiceCommand.REPEAT) }
            GloveButton("НЕ НАШЁЛ", Modifier.weight(1f), disabled, danger = true) { onCommand(VoiceCommand.NOT_FOUND) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GloveButton("ПРОПУСТИТЬ", Modifier.weight(1f), disabled) { onCommand(VoiceCommand.SKIP) }
            GloveButton("ОТМЕНИТЬ", Modifier.weight(1f), disabled) { onCommand(VoiceCommand.UNDO) }
        }
    }
}

@Composable
private fun GloveButton(label: String, modifier: Modifier, disabled: Boolean, danger: Boolean = false, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = !disabled,
        modifier = modifier.height(64.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = if (danger) Red else Color(0xFFDDE7E1), contentColor = if (danger) Color.White else Forest),
        contentPadding = ButtonDefaults.ContentPadding,
    ) { Text(label, fontWeight = FontWeight.Black, fontSize = 14.sp, textAlign = TextAlign.Center) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsCard(settings: PickerSettings, alenaAvailable: Boolean, onSettings: (PickerSettings) -> Unit) {
    Card(shape = RoundedCornerShape(18.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFFE9E6DC))) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("НАСТРОЙКИ ГОЛОСА", color = Forest, fontSize = 13.sp, fontWeight = FontWeight.Black)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = settings.voiceSource == VoiceSource.ALENA,
                    onClick = { onSettings(settings.copy(voiceSource = VoiceSource.ALENA)) },
                    label = { Text(if (alenaAvailable) "Alena" else "Alena · fallback") },
                )
                FilterChip(
                    selected = settings.voiceSource == VoiceSource.SYSTEM,
                    onClick = { onSettings(settings.copy(voiceSource = VoiceSource.SYSTEM)) },
                    label = { Text("Голос телефона") },
                )
            }
            Text("Скорость речи", color = Forest, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(1f, 1.12f, 1.22f, 1.35f).forEach { rate ->
                    FilterChip(
                        selected = settings.speechRate == rate,
                        onClick = { onSettings(settings.copy(speechRate = rate)) },
                        label = { Text(rate.toString()) },
                    )
                }
            }
            SettingSwitch("Звук", settings.soundEnabled) { onSettings(settings.copy(soundEnabled = it)) }
            SettingSwitch("Вибрация", settings.vibrationEnabled) { onSettings(settings.copy(vibrationEnabled = it)) }
            SettingSwitch("Короткие названия", settings.shortNames) { onSettings(settings.copy(shortNames = it)) }
        }
    }
}

@Composable
private fun SettingSwitch(label: String, checked: Boolean, onChecked: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Forest, fontWeight = FontWeight.Bold)
        Switch(checked = checked, onCheckedChange = onChecked)
    }
}

private fun formatQuantity(value: Double): String =
    if (value == value.toInt().toDouble()) value.toInt().toString() else value.toString().replace('.', ',')
