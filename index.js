const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Telegraf } = require('telegraf');
require('dotenv').config();

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
const db = require('./supabase');

const PORT = process.env.PORT || 3000;
const ADMIN_ID = process.env.ADMIN_ID || '6373481979';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurar multer para subir imágenes
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Crear carpetas necesarias
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('public')) fs.mkdirSync('public');

// Función auxiliar para nombres de planes
function getPlanName(planType) {
  const plans = {
    'basico': 'Básico (1 mes)',
    'premium': 'Premium (2 meses)',
    'vip': 'VIP (6 meses)'
  };
  return plans[planType] || planType;
}

// ==================== RUTAS DE LA API ====================

// 1. Aceptar términos
app.post('/api/accept-terms', async (req, res) => {
  try {
    const { telegramId, username, firstName } = req.body;
    
    const user = await db.saveUser(telegramId, {
      telegram_id: telegramId,
      username: username,
      first_name: firstName,
      accepted_terms: true,
      terms_date: new Date().toISOString()
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('Error aceptando términos:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// 2. Verificar términos aceptados
app.get('/api/check-terms/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    res.json({ accepted: user?.accepted_terms || false });
  } catch (error) {
    res.json({ accepted: false });
  }
});

// 3. Procesar pago (SIN ENVIAR AL CANAL)
app.post('/api/payment', upload.single('screenshot'), async (req, res) => {
  try {
    const { telegramId, plan, price, notes } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'Captura de pantalla requerida' });
    }

    // Obtener información del usuario
    const user = await db.getUser(telegramId);
    const username = user?.username ? `@${user.username}` : 'Sin usuario';
    const firstName = user?.first_name || 'Usuario';

    // Guardar pago en base de datos
    const payment = await db.createPayment({
      telegram_id: telegramId,
      plan: plan,
      price: parseFloat(price),
      screenshot_url: `/uploads/${req.file.filename}`,
      notes: notes || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    // 🔥 ENVIAR MENSAJE AL ADMIN POR PRIVADO (sin canal)
    try {
      await bot.telegram.sendMessage(
        ADMIN_ID,
        `💰 *NUEVO PAGO RECIBIDO*\n\n` +
        `👤 *Usuario:* ${firstName}\n` +
        `📱 *Telegram:* ${username}\n` +
        `🆔 *ID:* ${telegramId}\n` +
        `📋 *Plan:* ${getPlanName(plan)}\n` +
        `💰 *Monto:* $${price} CUP\n` +
        `⏰ *Fecha:* ${new Date().toLocaleString('es-ES')}\n` +
        `📝 *Estado:* ⏳ Pendiente\n\n` +
        `Para revisar y aprobar, usa /admin`,
        { parse_mode: 'Markdown' }
      );
    } catch (adminError) {
      console.log('Admin no disponible para notificación, pero pago guardado');
    }

    res.json({ 
      success: true, 
      message: 'Pago recibido. Te notificaremos cuando sea aprobado.',
      payment 
    });
  } catch (error) {
    console.error('Error procesando pago:', error);
    
    // Eliminar archivo si hubo error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error procesando pago' });
  }
});

// 🔥 AGREGAR ESTA FUNCIÓN PARA LOS BOTONES DEL CANAL
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  
  // Verificar si el usuario que hace clic es el admin
  if (ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.answerCbQuery('❌ Solo el administrador puede hacer esto');
  }
  
  if (data.startsWith('approve_')) {
    const paymentId = data.split('_')[1];
    
    try {
      const payment = await db.approvePayment(paymentId);
      
      if (payment) {
        // Notificar al usuario
        await bot.telegram.sendMessage(
          payment.telegram_id,
          '🎉 *¡Tu pago ha sido aprobado!*\n\n' +
          'Ahora eres usuario VIP de VPN Cuba.\n' +
          'En breve recibirás tu archivo de configuración.',
          { parse_mode: 'Markdown' }
        );
        
        // Actualizar mensaje en el canal
        if (ctx.callbackQuery.message) {
          await ctx.editMessageCaption({
            caption: `✅ *PAGO APROBADO* 🎉\n\n` +
                     `👤 Usuario: ${payment.telegram_id}\n` +
                     `📋 Plan: ${getPlanName(payment.plan)}\n` +
                     `💰 Monto: $${payment.price} CUP\n` +
                     `⏰ Fecha: ${new Date(payment.created_at).toLocaleString('es-ES')}\n` +
                     `📝 Estado: ✅ Aprobado\n\n` +
                     `Aprobado por: @${ctx.from.username || 'admin'}`,
            reply_markup: { inline_keyboard: [] }
          });
        }
        
        ctx.answerCbQuery('✅ Pago aprobado');
      }
    } catch (error) {
      console.error('Error aprobando pago:', error);
      ctx.answerCbQuery('❌ Error al aprobar pago');
    }
  } else if (data.startsWith('reject_')) {
    const paymentId = data.split('_')[1];
    
    try {
      const payment = await db.rejectPayment(paymentId, 'Rechazado por administrador');
      
      if (payment) {
        // Notificar al usuario
        await bot.telegram.sendMessage(
          payment.telegram_id,
          '❌ *Tu pago ha sido rechazado*\n\n' +
          'Por favor, contacta con soporte para más información: @vpncuba_support',
          { parse_mode: 'Markdown' }
        );
        
        // Actualizar mensaje en el canal
        if (ctx.callbackQuery.message) {
          await ctx.editMessageCaption({
            caption: `❌ *PAGO RECHAZADO*\n\n` +
                     `👤 Usuario: ${payment.telegram_id}\n` +
                     `📋 Plan: ${getPlanName(payment.plan)}\n` +
                     `💰 Monto: $${payment.price} CUP\n` +
                     `⏰ Fecha: ${new Date(payment.created_at).toLocaleString('es-ES')}\n` +
                     `📝 Estado: ❌ Rechazado\n\n` +
                     `Rechazado por: @${ctx.from.username || 'admin'}`,
            reply_markup: { inline_keyboard: [] }
          });
        }
        
        ctx.answerCbQuery('✅ Pago rechazado');
      }
    } catch (error) {
      console.error('Error rechazando pago:', error);
      ctx.answerCbQuery('❌ Error al rechazar pago');
    }
  }
});

// 4. Obtener pagos pendientes (para admin)
app.get('/api/payments/pending', async (req, res) => {
  try {
    const payments = await db.getPendingPayments();
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo pagos' });
  }
});

// 5. Aprobar pago
app.post('/api/payments/:id/approve', async (req, res) => {
  try {
    const payment = await db.approvePayment(req.params.id);
    
    if (payment) {
      // Notificar al usuario
      await bot.telegram.sendMessage(
        payment.telegram_id,
        '🎉 ¡Tu pago ha sido aprobado!\n\n' +
        'Ahora eres usuario VIP de VPN Cuba.\n' +
        'En breve recibirás tu archivo de configuración.'
      );
    }

    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ error: 'Error aprobando pago' });
  }
});

// 6. Rechazar pago
app.post('/api/payments/:id/reject', async (req, res) => {
  try {
    const payment = await db.rejectPayment(req.params.id, req.body.reason);
    res.json({ success: true, payment });
  } catch (error) {
    res.status(500).json({ error: 'Error rechazando pago' });
  }
});

// 7. Obtener estadísticas
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// 8. Obtener usuarios VIP
app.get('/api/vip-users', async (req, res) => {
  try {
    const users = await db.getVIPUsers();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error obteniendo usuarios VIP' });
  }
});

// 9. Servir archivos subidos
app.use('/uploads', express.static('uploads'));

// ==================== SERVIR ARCHIVOS HTML ====================

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Ruta para planes
app.get('/plans.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/plans.html'));
});

// Ruta para pago
app.get('/payment.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/payment.html'));
});

// Ruta para admin
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// Ruta para CSS
app.get('/css/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/css/style.css'));
});

// ==================== BOT DE TELEGRAM ====================

// Comando /start con botones
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}?userId=${userId}`;
  
  await ctx.reply(
    `¡Hola ${ctx.from.first_name || 'usuario'}! 👋\n\n` +
    `Bienvenido a *VPN Cuba* 🚀\n\n` +
    `Conéctate con la mejor latencia para gaming y navegación.\n\n` +
    `Usa los botones para navegar:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Ver Planes', web_app: { url: webappUrl } }],
          [{ text: '📋 Ver Planes', callback_data: 'view_plans' }],
          [{ text: '👑 Mi Estado', callback_data: 'check_status' }],
          [{ text: '📞 Soporte', url: 'https://t.me/vpncuba_support' }]
        ]
      }
    }
  );
});

// Botón: Ver planes
bot.action('view_plans', async (ctx) => {
  await ctx.editMessageText(
    `📋 *NUESTROS PLANES*\n\n` +
    `*Básico (1 mes)*\n` +
    `💵 $800 CUP\n\n` +
    `*Premium (2 meses)*\n` +
    `💵 $1,300 CUP\n` +
    `💰 ¡Ahorras $300 CUP!\n\n` +
    `*VIP (6 meses)*\n` +
    `💵 $3,000 CUP\n` +
    `👑 ¡MEJOR OFERTA!\n` +
    `💰 ¡Ahorras $1,800 CUP!\n` +
    `📅 Solo $500 CUP/mes\n\n` +
    `✅ Baja Latencia\n` +
    `✅ Ancho de Banda Ilimitado\n` +
    `✅ Soporte Prioritario\n\n` +
    `Para comprar, usa /comprar o haz clic en Ver Planes`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Ver Planes', web_app: { url: `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}?userId=${ctx.from.id}` } }
        ]]
      }
    }
  );
});

// Botón: Ver estado
bot.action('check_status', async (ctx) => {
  const user = await db.getUser(ctx.from.id.toString());
  
  if (user?.vip) {
    await ctx.editMessageText(
      `✅ *¡Eres usuario VIP!*\n\n` +
      `📋 Plan: ${user.plan || 'VIP'}\n` +
      `💰 Precio: $${user.plan_price || '3,000'} CUP\n` +
      `📅 VIP desde: ${new Date(user.vip_since).toLocaleDateString()}\n\n` +
      `Tu acceso está activo. Si necesitas ayuda, contacta con soporte.`,
      { parse_mode: 'Markdown' }
    );
  } else {
    await ctx.editMessageText(
      `❌ *No eres usuario VIP*\n\n` +
      `Aún no tienes acceso a los servicios premium.\n\n` +
      `Usa /comprar o haz clic en Ver Planes para adquirir tu plan.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🚀 Ver Planes', web_app: { url: `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}?userId=${ctx.from.id}` } }
          ]]
        }
      }
    );
  }
});

// Comando /comprar
bot.command('comprar', async (ctx) => {
  const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${ctx.from.id}`;
  
  await ctx.reply(
    `🛒 *Proceso de Compra*\n\n` +
    `Para realizar tu compra, haz clic en el botón de abajo:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Comprar Ahora', web_app: { url: webappUrl } }
        ]]
      }
    }
  );
});

// Comando /admin solo para el admin
bot.command('admin', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply('❌ Solo el administrador puede usar este comando.');
  }

  const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html`;
  
  await ctx.reply(
    `🔧 *Panel de Administración*\n\n` +
    `Selecciona una opción:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Abrir Panel Web', web_app: { url: webappUrl } }],
          [{ text: '⏳ Ver Pagos Pendientes', callback_data: 'view_pending' }],
          [{ text: '👑 Ver VIPs', callback_data: 'view_vips' }],
          [{ text: '📤 Enviar Configuración', callback_data: 'send_config' }]
        ]
      }
    }
  );
});

// Acción: Ver pagos pendientes
bot.action('view_pending', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.answerCbQuery('No autorizado');
  }

  const payments = await db.getPendingPayments();
  
  if (payments.length === 0) {
    return ctx.editMessageText('✅ No hay pagos pendientes.');
  }

  let message = '⏳ *Pagos Pendientes:*\n\n';
  payments.forEach((p, i) => {
    message += `${i+1}. 👤 ${p.telegram_id}\n`;
    message += `   📋 ${p.plan} - $${p.price} CUP\n`;
    message += `   📅 ${new Date(p.created_at).toLocaleDateString()}\n`;
    message += `   ---\n`;
  });

  await ctx.editMessageText(message, { parse_mode: 'Markdown' });
});

// Acción: Ver VIPs
bot.action('view_vips', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.answerCbQuery('No autorizado');
  }

  const users = await db.getVIPUsers();
  
  if (users.length === 0) {
    return ctx.editMessageText('👑 No hay usuarios VIP aún.');
  }

  let message = '👑 *Usuarios VIP:*\n\n';
  users.forEach((u, i) => {
    message += `${i+1}. 👤 ${u.first_name || ''} (@${u.username || 'sin_user'})\n`;
    message += `   📋 ${u.plan || 'VIP'} - $${u.plan_price || '0'} CUP\n`;
    message += `   📅 VIP desde: ${new Date(u.vip_since).toLocaleDateString()}\n`;
    message += `   ---\n`;
  });

  await ctx.editMessageText(message, { parse_mode: 'Markdown' });
});

// Acción: Enviar configuración
bot.action('send_config', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.answerCbQuery('No autorizado');
  }

  await ctx.reply(
    '📤 *Enviar Configuración*\n\n' +
    'Para enviar un archivo de configuración:\n' +
    '1. Usa el comando /enviar seguido del ID o @usuario\n' +
    '2. Ejemplo: /enviar 123456789\n' +
    '3. O: /enviar @username\n\n' +
    'Luego envía el archivo .conf',
    { parse_mode: 'Markdown' }
  );
});

// Comando /enviar para administrador
bot.command('enviar', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply('❌ Solo el administrador puede usar este comando.');
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Uso: /enviar <ID o @usuario>\nEjemplo: /enviar 123456789');
  }

  const target = args[1];
  ctx.session = ctx.session || {};
  ctx.session.waitingForFile = target;

  await ctx.reply(`📤 Esperando archivo para enviar a: ${target}\n\nPor favor, envía el archivo .conf ahora:`);
});

// Manejar archivos enviados por admin
bot.on('document', async (ctx) => {
  if (ctx.session?.waitingForFile && ctx.from.id.toString() === ADMIN_ID) {
    const target = ctx.session.waitingForFile;
    const fileId = ctx.message.document.file_id;
    const fileName = ctx.message.document.file_name;

    try {
      // Guardar registro
      await db.saveConfigFile({
        telegram_id: target.replace('@', ''),
        file_id: fileId,
        file_name: fileName,
        sent_by: ctx.from.username || 'admin',
        sent_at: new Date().toISOString()
      });

      // Enviar al usuario
      await ctx.telegram.sendDocument(target, fileId, {
        caption: '🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n' +
                '📁 Importa este archivo en WireGuard\n' +
                '🚀 ¡Disfruta de baja latencia!',
        parse_mode: 'Markdown'
      });

      await ctx.reply(`✅ Archivo enviado a ${target}`);
    } catch (error) {
      console.error('Error enviando archivo:', error);
      await ctx.reply(`❌ Error enviando archivo: ${error.message}`);
    }

    delete ctx.session.waitingForFile;
  }
});

// ==================== SERVIDOR ====================

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  
  // Iniciar bot
  try {
    await bot.launch();
    console.log('🤖 Bot de Telegram iniciado');
    
    // Configurar comandos del bot
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Iniciar el bot' },
      { command: 'comprar', description: 'Comprar un plan' },
      { command: 'admin', description: 'Panel de administración' }
    ]);
  } catch (error) {
    console.error('Error iniciando bot:', error);
  }
});

// Manejar cierre
process.on('SIGINT', () => {
  console.log('\n👋 Cerrando aplicación...');
  process.exit(0);
});
