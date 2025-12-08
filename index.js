const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const db = require('./supabase');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configuración del bot
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('❌ Error: Faltan variables de entorno TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static('public'));

// ========== RUTAS PARA EL PANEL ADMIN ==========

// Ruta principal del panel admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Ruta para verificar administrador
app.get('/api/check-admin/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await db.getUser(userId);
    
    // Verificar si es admin (puedes tener una lista de admin IDs en .env)
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
    const isAdmin = adminIds.includes(userId) || (user && user.admin === true);
    
    res.json({ isAdmin: isAdmin, user: user });
  } catch (error) {
    console.error('❌ Error verificando admin:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener estadísticas
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener pagos pendientes
app.get('/api/payments/pending', async (req, res) => {
  try {
    const payments = await db.getPendingPayments();
    
    // Para cada pago, obtener información del usuario
    const paymentsWithUser = await Promise.all(payments.map(async (payment) => {
      const user = await db.getUser(payment.telegram_id);
      return { ...payment, user };
    }));
    
    res.json(paymentsWithUser);
  } catch (error) {
    console.error('❌ Error obteniendo pagos pendientes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener pagos aprobados
app.get('/api/payments/approved', async (req, res) => {
  try {
    const payments = await db.getApprovedPayments();
    
    const paymentsWithUser = await Promise.all(payments.map(async (payment) => {
      const user = await db.getUser(payment.telegram_id);
      return { ...payment, user };
    }));
    
    res.json(paymentsWithUser);
  } catch (error) {
    console.error('❌ Error obteniendo pagos aprobados:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para aprobar un pago
app.post('/api/payments/:id/approve', async (req, res) => {
  try {
    const paymentId = req.params.id;
    const payment = await db.approvePayment(paymentId);
    
    // Obtener información del usuario
    const user = await db.getUser(payment.telegram_id);
    
    // Marcar al usuario como VIP
    await db.makeUserVIP(payment.telegram_id, {
      plan: payment.plan,
      plan_price: payment.price
    });
    
    // Enviar mensaje al usuario notificando la aprobación
    try {
      await bot.sendMessage(
        payment.telegram_id,
        `✅ *¡Pago Aprobado!*\n\n` +
        `Tu pago por el plan *${payment.plan}* ha sido aprobado.\n` +
        `Monto: $${payment.price} CUP\n` +
        `En breve recibirás tu archivo de configuración.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('❌ Error enviando mensaje al usuario:', error);
    }
    
    res.json({ success: true, payment, user });
  } catch (error) {
    console.error('❌ Error aprobando pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para rechazar un pago
app.post('/api/payments/:id/reject', async (req, res) => {
  try {
    const paymentId = req.params.id;
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Se requiere un motivo' });
    }
    
    const payment = await db.rejectPayment(paymentId, reason);
    
    // Enviar mensaje al usuario notificando el rechazo
    try {
      await bot.sendMessage(
        payment.telegram_id,
        `❌ *Pago Rechazado*\n\n` +
        `Tu pago por el plan *${payment.plan}* ha sido rechazado.\n` +
        `Motivo: ${reason}\n\n` +
        `Si crees que esto es un error, contacta con el administrador.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('❌ Error enviando mensaje al usuario:', error);
    }
    
    res.json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error rechazando pago:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para enviar archivo de configuración
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/send-config', upload.single('configFile'), async (req, res) => {
  try {
    const { paymentId, telegramId, adminId } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Actualizar el pago como config enviada
    await db.updatePayment(paymentId, { 
      config_sent: true, 
      config_sent_at: new Date().toISOString() 
    });

    // Guardar registro del archivo enviado
    await db.saveConfigFile({
      payment_id: paymentId,
      telegram_id: telegramId,
      sent_by: adminId,
      file_type: 'config',
      file_name: file.originalname,
      file_size: file.size,
      sent_at: new Date().toISOString()
    });

    // Enviar archivo al usuario
    try {
      await bot.sendDocument(
        telegramId,
        file.path,
        {
          caption: `📁 *¡Configuración Enviada!*\n\n` +
                  `Aquí está tu archivo de configuración para el plan.\n` +
                  `Sigue las instrucciones para configurar tu VPN.\n\n` +
                  `*Nombre:* ${file.originalname}\n` +
                  `*Tamaño:* ${(file.size / 1024).toFixed(2)} KB`
        }
      );

      // Eliminar archivo temporal
      fs.unlinkSync(file.path);

    } catch (error) {
      console.error('❌ Error enviando archivo al usuario:', error);
      return res.status(500).json({ error: 'Error enviando archivo al usuario' });
    }

    res.json({ success: true, message: 'Configuración enviada' });
  } catch (error) {
    console.error('❌ Error enviando configuración:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para enviar configuración de prueba
app.post('/api/send-trial-config', upload.single('trialConfigFile'), async (req, res) => {
  try {
    const { telegramId, adminId, trialType } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Marcar la prueba como enviada
    await db.markTrialAsSent(telegramId, adminId);

    // Enviar archivo al usuario
    try {
      await bot.sendDocument(
        telegramId,
        file.path,
        {
          caption: `🎁 *¡Prueba Gratuita Enviada!*\n\n` +
                  `Aquí está tu prueba gratuita de ${trialType}.\n` +
                  `Sigue las instrucciones para configurar tu VPN.\n\n` +
                  `*Duración:* ${trialType}\n` +
                  `*Nombre:* ${file.originalname}\n` +
                  `*Tamaño:* ${(file.size / 1024).toFixed(2)} KB\n\n` +
                  `¡Disfruta de tu prueba! 🎮`
        }
      );

      // Eliminar archivo temporal
      fs.unlinkSync(file.path);

    } catch (error) {
      console.error('❌ Error enviando archivo de prueba al usuario:', error);
      return res.status(500).json({ error: 'Error enviando archivo de prueba' });
    }

    res.json({ success: true, message: 'Prueba enviada' });
  } catch (error) {
    console.error('❌ Error enviando prueba:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener todos los usuarios
app.get('/api/all-users', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para remover VIP de un usuario
app.post('/api/remove-vip', async (req, res) => {
  try {
    const { telegramId, adminId } = req.body;
    
    await db.removeVIP(telegramId);
    
    // Enviar mensaje al usuario
    try {
      await bot.sendMessage(
        telegramId,
        `⚠️ *Estado VIP Actualizado*\n\n` +
        `Tu estado VIP ha sido removido por el administrador.\n` +
        `Si crees que esto es un error, contacta con el administrador.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('❌ Error enviando mensaje al usuario:', error);
    }
    
    res.json({ success: true, message: 'VIP removido' });
  } catch (error) {
    console.error('❌ Error removiendo VIP:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para enviar mensaje a un usuario
app.post('/api/send-message', async (req, res) => {
  try {
    const { telegramId, message, adminId } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    
    // Enviar mensaje al usuario
    await bot.sendMessage(telegramId, message, { parse_mode: 'Markdown' });
    
    res.json({ success: true, message: 'Mensaje enviado' });
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener estadísticas de pruebas
app.get('/api/trial-stats', async (req, res) => {
  try {
    const stats = await db.getTrialStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas de prueba:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener pruebas pendientes
app.get('/api/trials/pending', async (req, res) => {
  try {
    const trials = await db.getPendingTrials();
    
    // Enriquecer con información de días esperando
    const enrichedTrials = trials.map(trial => {
      let daysAgo = 0;
      if (trial.trial_requested_at) {
        const requestedDate = new Date(trial.trial_requested_at);
        const now = new Date();
        daysAgo = Math.floor((now - requestedDate) / (1000 * 60 * 60 * 24));
      }
      
      return {
        ...trial,
        trial_info: {
          game_server: trial.trial_game_server || 'No especificado',
          connection_type: trial.trial_connection_type || 'No especificado',
          days_ago: daysAgo
        }
      };
    });
    
    res.json(enrichedTrials);
  } catch (error) {
    console.error('❌ Error obteniendo pruebas pendientes:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener usuarios activos (últimos 30 días)
app.get('/api/users/active', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const activeUsers = users.filter(user => {
      if (!user.updated_at) return false;
      const updatedDate = new Date(user.updated_at);
      return updatedDate >= thirtyDaysAgo;
    });
    
    res.json(activeUsers);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios activos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ========== RUTAS PARA BROADCAST (PARA EL PANEL ADMIN) ==========

// Ruta para crear un broadcast
app.post('/api/broadcast/create', async (req, res) => {
  try {
    const { message, target, adminId } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    }
    
    const broadcast = await db.createBroadcast(message, target, adminId);
    
    res.json(broadcast);
  } catch (error) {
    console.error('❌ Error creando broadcast:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener broadcasts
app.get('/api/broadcasts', async (req, res) => {
  try {
    const broadcasts = await db.getBroadcasts();
    res.json(broadcasts);
  } catch (error) {
    console.error('❌ Error obteniendo broadcasts:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para obtener el estado de un broadcast
app.get('/api/broadcast/status/:id', async (req, res) => {
  try {
    const broadcastId = req.params.id;
    
    // Obtener el broadcast
    const { data: broadcast, error: broadcastError } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('id', broadcastId)
      .single();
    
    if (broadcastError) {
      return res.status(404).json({ error: 'Broadcast no encontrado' });
    }
    
    res.json(broadcast);
  } catch (error) {
    console.error('❌ Error obteniendo estado de broadcast:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para enviar un broadcast (iniciar el envío)
app.post('/api/broadcast/send', async (req, res) => {
  try {
    const { broadcastId, target, adminId } = req.body;
    
    // Obtener el broadcast
    const { data: broadcast, error: broadcastError } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('id', broadcastId)
      .single();
    
    if (broadcastError) {
      return res.status(404).json({ error: 'Broadcast no encontrado' });
    }
    
    // Obtener usuarios destino
    const users = await db.getUsersForBroadcast(target);
    
    // Actualizar estado a "enviando"
    await db.updateBroadcastStatus(broadcastId, 'sending', {
      total_users: users.length
    });
    
    // Iniciar el envío en segundo plano (no bloquear la respuesta)
    sendBroadcastMessages(broadcastId, users, broadcast.message, adminId);
    
    res.json({
      success: true,
      message: 'Broadcast iniciado',
      total_users: users.length
    });
  } catch (error) {
    console.error('❌ Error iniciando broadcast:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Función para enviar mensajes de broadcast en segundo plano
async function sendBroadcastMessages(broadcastId, users, message, adminId) {
  let sentCount = 0;
  let failedCount = 0;
  
  console.log(`📢 Iniciando envío de broadcast a ${users.length} usuarios`);
  
  // Limitar el número de mensajes por segundo para no sobrecargar la API
  const BATCH_SIZE = 10;
  const DELAY_BETWEEN_BATCHES = 1000; // 1 segundo
  
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    
    // Enviar en paralelo cada batch
    const promises = batch.map(user => 
      bot.sendMessage(user.telegram_id, message, { parse_mode: 'Markdown' })
        .then(() => {
          sentCount++;
          return { success: true, userId: user.telegram_id };
        })
        .catch(error => {
          console.error(`❌ Error enviando a ${user.telegram_id}:`, error.message);
          failedCount++;
          return { success: false, userId: user.telegram_id, error: error.message };
        })
    );
    
    await Promise.all(promises);
    
    // Actualizar progreso
    await db.updateBroadcastStatus(broadcastId, 'sending', {
      sent_count: sentCount,
      failed_count: failedCount,
      total_users: users.length
    });
    
    console.log(`📤 Progreso: ${sentCount}/${users.length} enviados`);
    
    // Esperar antes del siguiente batch
    if (i + BATCH_SIZE < users.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  // Marcar como completado
  await db.updateBroadcastStatus(broadcastId, 'completed', {
    sent_count: sentCount,
    failed_count: failedCount,
    total_users: users.length
  });
  
  console.log(`✅ Broadcast completado: ${sentCount} enviados, ${failedCount} fallidos`);
  
  // Notificar al administrador
  if (adminId) {
    try {
      await bot.sendMessage(
        adminId,
        `📢 *Broadcast Completado*\n\n` +
        `ID: ${broadcastId}\n` +
        `Enviados: ${sentCount}\n` +
        `Fallidos: ${failedCount}\n` +
        `Total: ${users.length}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('❌ Error notificando al administrador:', error);
    }
  }
}

// Ruta para reintentar un broadcast
app.post('/api/broadcast/retry/:id', async (req, res) => {
  try {
    const broadcastId = req.params.id;
    const { adminId } = req.body;
    
    const { data: broadcast, error: broadcastError } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('id', broadcastId)
      .single();
    
    if (broadcastError) {
      return res.status(404).json({ error: 'Broadcast no encontrado' });
    }
    
    // Obtener usuarios destino
    const users = await db.getUsersForBroadcast(broadcast.target_users);
    
    // Actualizar estado a "enviando"
    await db.updateBroadcastStatus(broadcastId, 'sending', {
      total_users: users.length
    });
    
    // Iniciar el envío en segundo plano
    sendBroadcastMessages(broadcastId, users, broadcast.message, adminId);
    
    res.json({
      success: true,
      message: 'Reintento de broadcast iniciado',
      total_users: users.length
    });
  } catch (error) {
    console.error('❌ Error reintentando broadcast:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ========== HEALTH CHECK PARA KEEP-ALIVE ==========
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV || 'development'
  });
});

// ========== INICIAR SERVIDOR ==========
app.listen(port, () => {
  console.log(`🚀 Servidor escuchando en puerto ${port}`);
});

// ========== COMANDOS DEL BOT ==========

// Comando /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const firstName = msg.from.first_name;
  
  console.log(`🚀 Usuario ${userId} (${firstName}) inició el bot`);
  
  // Guardar usuario en la base de datos
  await db.saveUser(userId, {
    username: msg.from.username,
    first_name: firstName,
    last_name: msg.from.last_name,
    language_code: msg.from.language_code
  });
  
  // Mensaje de bienvenida
  const welcomeMessage = `¡Hola ${firstName}! 👋\n\n` +
    `Bienvenido a *VPN CUBA* - Tu solución para una conexión segura y estable.\n\n` +
    `📡 *Servicios que ofrecemos:*\n` +
    `• VPN para juegos online 🎮\n` +
    `• VPN para streaming 📺\n` +
    `• VPN para navegación segura 🔒\n\n` +
    `💎 *Planes disponibles:*\n` +
    `• *Básico:* 1 mes - $250 CUP\n` +
    `• *Premium:* 2 meses - $400 CUP\n` +
    `• *VIP:* 6 meses - $900 CUP\n\n` +
    `🎁 *¡Prueba gratuita disponible!*\n` +
    `Solicita una prueba de 1 hora para probar nuestro servicio.\n\n` +
    `Usa los comandos abajo para comenzar ↓`;
  
  // Teclado con opciones
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📋 Ver Planes', callback_data: 'view_plans' },
          { text: '🎁 Prueba Gratis', callback_data: 'request_trial' }
        ],
        [
          { text: '📞 Soporte', callback_data: 'support' },
          { text: '📝 Términos', callback_data: 'terms' }
        ]
      ]
    },
    parse_mode: 'Markdown'
  };
  
  await bot.sendMessage(chatId, welcomeMessage, options);
});

// Manejar callbacks de botones
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  
  console.log(`🔘 Callback: ${userId} -> ${data}`);
  
  try {
    switch (data) {
      case 'view_plans':
        await showPlans(chatId, userId);
        break;
      case 'request_trial':
        await requestTrial(chatId, userId);
        break;
      case 'support':
        await showSupport(chatId);
        break;
      case 'terms':
        await showTerms(chatId, userId);
        break;
      case 'accept_terms':
        await acceptTerms(chatId, userId);
        break;
      case 'trial_1h':
        await processTrialRequest(chatId, userId, '1h');
        break;
      case 'trial_24h':
        await processTrialRequest(chatId, userId, '24h');
        break;
      case 'plan_basico':
        await processPlanSelection(chatId, userId, 'basico', 250);
        break;
      case 'plan_premium':
        await processPlanSelection(chatId, userId, 'premium', 400);
        break;
      case 'plan_vip':
        await processPlanSelection(chatId, userId, 'vip', 900);
        break;
      default:
        if (data.startsWith('pay_')) {
          const plan = data.split('_')[1];
          await processPayment(chatId, userId, plan);
        }
    }
    
    // Responder al callback para quitar el "cargando" del botón
    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('❌ Error manejando callback:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Ocurrió un error' });
  }
});

// Función para mostrar planes
async function showPlans(chatId, userId) {
  const plansMessage = `📋 *Planes Disponibles*\n\n` +
    `*1. Plan Básico* 💎\n` +
    `• Duración: 1 mes\n` +
    `• Precio: *$250 CUP*\n` +
    `• Soporte: Básico\n\n` +
    `*2. Plan Premium* 🚀\n` +
    `• Duración: 2 meses\n` +
    `• Precio: *$400 CUP*\n` +
    `• Soporte: Prioritario\n` +
    `• Velocidad mejorada\n\n` +
    `*3. Plan VIP* 👑\n` +
    `• Duración: 6 meses\n` +
    `• Precio: *$900 CUP*\n` +
    `• Soporte: 24/7\n` +
    `• Velocidad máxima\n` +
    `• Configuración personalizada\n\n` +
    `*Método de pago:* Transferencia por EnZona o Transfermóvil\n` +
    `*Beneficios adicionales:*\n` +
    `• Configuración asistida\n` +
    `• Soporte técnico\n` +
    `• Actualizaciones gratuitas`;
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Básico - $250 CUP', callback_data: 'plan_basico' },
          { text: 'Premium - $400 CUP', callback_data: 'plan_premium' }
        ],
        [
          { text: 'VIP - $900 CUP', callback_data: 'plan_vip' }
        ],
        [
          { text: '🎁 Prueba Gratis', callback_data: 'request_trial' },
          { text: '🔙 Volver', callback_data: 'back_to_start' }
        ]
      ]
    },
    parse_mode: 'Markdown'
  };
  
  await bot.sendMessage(chatId, plansMessage, options);
}

// Función para solicitar prueba
async function requestTrial(chatId, userId) {
  // Verificar elegibilidad
  const eligibility = await db.checkTrialEligibility(userId);
  
  if (!eligibility.eligible) {
    await bot.sendMessage(
      chatId,
      `❌ *No eres elegible para una prueba gratuita*\n\n` +
      `Motivo: ${eligibility.reason}\n\n` +
      `Puedes adquirir uno de nuestros planes para disfrutar del servicio.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }
  
  const trialMessage = `🎁 *Prueba Gratuita*\n\n` +
    `Ofrecemos pruebas gratuitas para que pruebes nuestro servicio:\n\n` +
    `*1. Prueba de 1 hora*\n` +
    `• Ideal para probar juegos específicos\n` +
    `• Configuración rápida\n\n` +
    `*2. Prueba de 24 horas*\n` +
    `• Para uso extendido\n` +
    `• Prueba de estabilidad\n\n` +
    `*Requisitos:*\n` +
    `• Debes especificar para qué juego/servidor necesitas la VPN\n` +
    `• Indicar el tipo de conexión que usas\n` +
    `• Solo una prueba por usuario cada 30 días`;
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⏰ 1 Hora', callback_data: 'trial_1h' },
          { text: '⏱️ 24 Horas', callback_data: 'trial_24h' }
        ],
        [
          { text: '🔙 Volver', callback_data: 'view_plans' }
        ]
      ]
    },
    parse_mode: 'Markdown'
  };
  
  await bot.sendMessage(chatId, trialMessage, options);
}

// Función para procesar solicitud de prueba
async function processTrialRequest(chatId, userId, trialType) {
  // Guardar solicitud de prueba
  await db.saveUser(userId, {
    trial_requested: true,
    trial_plan_type: trialType
  });
  
  // Pedir información adicional
  const infoMessage = `📝 *Información Requerida para la Prueba*\n\n` +
    `Para procesar tu solicitud de prueba de *${trialType}*, necesitamos que nos proporciones:\n\n` +
    `1. *🎮 Juego o Servidor:*\n` +
    `   ¿Para qué juego o servicio necesitas la VPN?\n\n` +
    `2. *📡 Tipo de Conexión:*\n` +
    `   ¿Qué tipo de conexión usas? (Ej: WiFi, Ethernet, Datos móviles)\n\n` +
    `*Envía esta información en un solo mensaje.*`;
  
  await bot.sendMessage(chatId, infoMessage, { parse_mode: 'Markdown' });
  
  // Escuchar la respuesta del usuario
  bot.once('message', async (msg) => {
    if (msg.chat.id === chatId && msg.from.id === userId) {
      const userResponse = msg.text;
      
      // Extraer información
      const lines = userResponse.split('\n');
      let gameServer = 'No especificado';
      let connectionType = 'No especificado';
      
      for (const line of lines) {
        if (line.toLowerCase().includes('juego') || line.toLowerCase().includes('servidor')) {
          gameServer = line.replace(/.*[juegoservidor:]+/i, '').trim() || 'No especificado';
        }
        if (line.toLowerCase().includes('conexión') || line.toLowerCase().includes('conexion')) {
          connectionType = line.replace(/.*[conexiónconexion:]+/i, '').trim() || 'No especificado';
        }
      }
      
      // Si no se detectaron, usar el mensaje completo
      if (gameServer === 'No especificado' && connectionType === 'No especificado') {
        gameServer = userResponse.substring(0, 100); // Limitar a 100 caracteres
      }
      
      // Actualizar información de prueba
      await db.updateUserTrial(userId, {
        trial_game_server: gameServer,
        trial_connection_type: connectionType
      });
      
      // Confirmación
      await bot.sendMessage(
        chatId,
        `✅ *Solicitud de Prueba Recibida*\n\n` +
        `Hemos recibido tu solicitud para una prueba de *${trialType}*.\n\n` +
        `*Información proporcionada:*\n` +
        `• 🎮 Juego/Servidor: ${gameServer}\n` +
        `• 📡 Tipo de Conexión: ${connectionType}\n\n` +
        `Un administrador revisará tu solicitud y te enviará la configuración pronto.\n` +
        `Tiempo estimado: 1-24 horas.\n\n` +
        `Gracias por tu paciencia.`,
        { parse_mode: 'Markdown' }
      );
      
      // Notificar a los administradores
      const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
      for (const adminId of adminIds) {
        try {
          await bot.sendMessage(
            adminId,
            `🎁 *Nueva Solicitud de Prueba*\n\n` +
            `Usuario: @${msg.from.username || 'sin_usuario'} (${msg.from.first_name})\n` +
            `ID: ${userId}\n` +
            `Tipo: ${trialType}\n` +
            `Juego: ${gameServer}\n` +
            `Conexión: ${connectionType}\n\n` +
            `[Ver en panel](/admin?userId=${adminId}&admin=true)`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.error(`❌ Error notificando a admin ${adminId}:`, error);
        }
      }
    }
  });
}

// Función para mostrar soporte
async function showSupport(chatId) {
  const supportMessage = `📞 *Soporte y Contacto*\n\n` +
    `¿Necesitas ayuda? Aquí estamos para asistirte:\n\n` +
    `*Contacto directo:*\n` +
    `• @admin1 - Soporte general\n` +
    `• @admin2 - Soporte técnico\n\n` +
    `*Horario de atención:*\n` +
    `Lunes a Domingo: 9:00 AM - 12:00 PM\n\n` +
    `*Para una atención más rápida:*\n` +
    `1. Especifica tu problema con detalle\n` +
    `2. Incluye capturas de pantalla si es posible\n` +
    `3. Menciona tu ID: \`${chatId}\``;
  
  await bot.sendMessage(chatId, supportMessage, { parse_mode: 'Markdown' });
}

// Función para mostrar términos
async function showTerms(chatId, userId) {
  const termsMessage = `📝 *Términos y Condiciones*\n\n` +
    `*1. Uso del Servicio*\n` +
    `• El servicio es para uso personal\n` +
    `• No se permite compartir cuentas\n` +
    `• No se permite uso para actividades ilegales\n\n` +
    `*2. Garantía*\n` +
    `• Garantizamos un 95% de uptime\n` +
    `• Soporte técnico incluido\n` +
    `• No hay reembolsos después de 24 horas\n\n` +
    `*3. Privacidad*\n` +
    `• No almacenamos logs de actividad\n` +
    `• Tus datos están protegidos\n` +
    `• No compartimos información con terceros\n\n` +
    `*4. Responsabilidad*\n` +
    `• No nos hacemos responsables por mal uso\n` +
    `• El usuario es responsable de su conexión\n` +
    `• Puede haber interrupciones por mantenimiento`;
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Aceptar Términos', callback_data: 'accept_terms' },
          { text: '❌ Rechazar', callback_data: 'reject_terms' }
        ]
      ]
    },
    parse_mode: 'Markdown'
  };
  
  await bot.sendMessage(chatId, termsMessage, options);
}

// Función para aceptar términos
async function acceptTerms(chatId, userId) {
  await db.acceptTerms(userId);
  
  await bot.sendMessage(
    chatId,
    `✅ *Términos Aceptados*\n\n` +
    `Has aceptado nuestros términos y condiciones.\n` +
    `Ahora puedes disfrutar de todos nuestros servicios.`,
    { parse_mode: 'Markdown' }
  );
}

// Función para procesar selección de plan
async function processPlanSelection(chatId, userId, plan, price) {
  const planNames = {
    'basico': 'Básico (1 mes)',
    'premium': 'Premium (2 meses)',
    'vip': 'VIP (6 meses)'
  };
  
  const planMessage = `🛒 *Confirmación de Plan*\n\n` +
    `*Plan seleccionado:* ${planNames[plan]}\n` +
    `*Precio:* $${price} CUP\n\n` +
    `*Instrucciones de pago:*\n` +
    `1. Realiza una transferencia de *$${price} CUP* a:\n` +
    `   • EnZona: 1234567890\n` +
    `   • Transfermóvil: 1234567890\n\n` +
    `2. Toma una captura de pantalla del comprobante\n` +
    `3. Envía la captura aquí\n\n` +
    `*Nota:* Una vez verificado el pago, recibirás tu configuración en menos de 24 horas.`;
  
  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📤 Enviar Comprobante', callback_data: `pay_${plan}` }
        ],
        [
          { text: '🔙 Cambiar Plan', callback_data: 'view_plans' }
        ]
      ]
    },
    parse_mode: 'Markdown'
  };
  
  await bot.sendMessage(chatId, planMessage, options);
}

// Función para procesar pago
async function processPayment(chatId, userId, plan) {
  // Crear registro de pago pendiente
  const payment = await db.createPayment({
    telegram_id: userId,
    plan: plan,
    price: plan === 'basico' ? 250 : plan === 'premium' ? 400 : 900,
    status: 'pending'
  });
  
  await bot.sendMessage(
    chatId,
    `📸 *Listo para recibir comprobante*\n\n` +
    `Ahora puedes enviar la captura de pantalla del comprobante de pago.\n\n` +
    `*ID de transacción:* ${payment.id}\n` +
    `*Importante:* Asegúrate de que la captura sea clara y legible.`,
    { parse_mode: 'Markdown' }
  );
  
  // Escuchar para recibir la foto
  bot.once('photo', async (msg) => {
    if (msg.chat.id === chatId && msg.from.id === userId) {
      try {
        // Obtener la foto de mayor calidad
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        
        // Descargar la foto
        const file = await bot.getFile(fileId);
        const filePath = file.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
        
        // Actualizar pago con la URL
        await db.updatePayment(payment.id, {
          screenshot_url: downloadUrl,
          screenshot_received: true
        });
        
        // Confirmar recepción
        await bot.sendMessage(
          chatId,
          `✅ *Comprobante Recibido*\n\n` +
          `Hemos recibido tu comprobante de pago.\n` +
          `ID de transacción: ${payment.id}\n\n` +
          `Un administrador revisará tu pago y te enviará la configuración pronto.\n` +
          `Tiempo estimado: 1-24 horas.\n\n` +
          `Gracias por tu compra.`,
          { parse_mode: 'Markdown' }
        );
        
        // Notificar a los administradores
        const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
        for (const adminId of adminIds) {
          try {
            await bot.sendMessage(
              adminId,
              `💰 *Nuevo Pago Recibido*\n\n` +
              `Usuario: @${msg.from.username || 'sin_usuario'} (${msg.from.first_name})\n` +
              `ID: ${userId}\n` +
              `Plan: ${plan}\n` +
              `Monto: $${payment.price} CUP\n` +
              `ID Pago: ${payment.id}\n\n` +
              `[Ver en panel](/admin?userId=${adminId}&admin=true)`,
              { parse_mode: 'Markdown' }
            );
            
            // Enviar la captura al administrador
            await bot.sendPhoto(adminId, fileId, {
              caption: `Comprobante de pago - ID: ${payment.id}`
            });
          } catch (error) {
            console.error(`❌ Error notificando a admin ${adminId}:`, error);
          }
        }
        
      } catch (error) {
        console.error('❌ Error procesando foto:', error);
        await bot.sendMessage(chatId, '❌ Ocurrió un error al procesar tu comprobante. Intenta nuevamente.');
      }
    }
  });
}

// ========== KEEP ALIVE CONFIGURATION ==========
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutos
const HEALTH_CHECK_URL = process.env.HEALTH_CHECK_URL || `http://localhost:${port}/health`;

// Función para mantener el bot activo
async function keepAlive() {
  try {
    console.log('🫀 Ejecutando keep-alive...');
    
    // Hacer ping al health check endpoint
    if (HEALTH_CHECK_URL) {
      try {
        const response = await fetch(HEALTH_CHECK_URL);
        console.log(`✅ Health check: ${response.status}`);
      } catch (error) {
        console.log(`⚠️ Health check falló: ${error.message}`);
      }
    }
    
    // Ejecutar una consulta simple a la base de datos
    try {
      const userCount = await db.getAllUsers();
      console.log(`✅ Keep-alive ejecutado. Usuarios totales: ${userCount.length}`);
      
      // Enviar estadísticas periódicas al administrador
      if (process.env.ADMIN_CHAT_ID && process.env.NODE_ENV === 'production') {
        const vipCount = userCount.filter(u => u.vip).length;
        const trialPending = userCount.filter(u => u.trial_requested && !u.trial_received).length;
        
        // Enviar solo una vez al día para no spamear
        const now = new Date();
        const hours = now.getHours();
        
        if (hours === 9 || hours === 15 || hours === 21) { // 9 AM, 3 PM, 9 PM
          await bot.sendMessage(
            process.env.ADMIN_CHAT_ID,
            `🤖 *Reporte de Actividad*\n` +
            `Hora: ${now.toLocaleTimeString('es-ES')}\n` +
            `👥 Usuarios: ${userCount.length}\n` +
            `👑 VIP: ${vipCount}\n` +
            `⏳ Pruebas pendientes: ${trialPending}\n` +
            `🫀 Bot activo desde: ${Math.floor(process.uptime() / 3600)}h`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } catch (error) {
      console.log(`⚠️ Consulta a DB falló: ${error.message}`);
    }
    
  } catch (error) {
    console.error('❌ Error en keep-alive:', error.message);
  }
}

// Iniciar keep-alive periódico
console.log('🚀 Iniciando keep-alive cada 5 minutos...');
setInterval(keepAlive, KEEP_ALIVE_INTERVAL);

// Ejecutar inmediatamente al iniciar
setTimeout(keepAlive, 10000);

// También ejecutar keep-alive al azar para evitar que coincida con otros procesos
setTimeout(() => {
  setInterval(keepAlive, KEEP_ALIVE_INTERVAL + Math.random() * 60000); // Variación aleatoria de hasta 1 minuto
}, 30000);

// Manejar señales de terminación
process.on('SIGTERM', () => {
  console.log('🔴 Recibido SIGTERM, cerrando bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔴 Recibido SIGINT, cerrando bot...');
  bot.stopPolling();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ Excepción no capturada:', error);
  // No salir, solo registrar el error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Promesa rechazada no manejada:', reason);
  // No salir, solo registrar el error
});

console.log('🤖 Bot de Telegram iniciado correctamente');
