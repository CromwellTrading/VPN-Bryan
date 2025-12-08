const { Telegraf, session, Markup } = require('telegraf');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const db = require('./supabase');
require('dotenv').config();

// ========== CONFIGURACIÓN INICIAL ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 10000; // Usa 10000 como default
const ADMIN_CHAT_ID = process.env.ADMIN_ID || process.env.ADMIN_CHAT_ID; // Soporta ambos nombres
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 minutos
const WEBAPP_URL = process.env.WEBAPP_URL || `http://localhost:${PORT}`;
const WHATSAPP_GROUP_URL = process.env.WHATSAPP_GROUP_URL || 'https://chat.whatsapp.com/BYa6hrCs4jkAuefEGwZUY9?mode=hqrc';

if (!BOT_TOKEN) {
  console.error('❌ Error: Faltan variables de entorno BOT_TOKEN');
  process.exit(1);
}

// Inicializar bot y Express
const bot = new Telegraf(BOT_TOKEN);
const app = express();

// Middleware para parsear JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== MIDDLEWARES DEL BOT ==========
bot.use(session());

// Middleware para registrar usuarios
bot.use(async (ctx, next) => {
  if (ctx.from) {
    const user = await db.getUser(ctx.from.id);
    if (!user) {
      // Registrar nuevo usuario
      await db.saveUser(ctx.from.id, {
        username: ctx.from.username,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
        language_code: ctx.from.language_code,
        is_bot: ctx.from.is_bot,
        last_activity: new Date().toISOString()
      });
      console.log(`🆕 Nuevo usuario registrado: ${ctx.from.first_name} (@${ctx.from.username || 'sin_usuario'})`);
    } else {
      // Actualizar última actividad
      await db.updateUser(ctx.from.id, {
        last_activity: new Date().toISOString()
      });
    }
  }
  return next();
});

// ========== KEEP ALIVE CONFIGURATION ==========

// Función para mantener el bot activo
async function keepAlive() {
  try {
    console.log('🫀 Ejecutando keep-alive...');
    
    // Opción 1: Hacer ping a la propia aplicación
    try {
      const response = await fetch(`${WEBAPP_URL}/health`);
      console.log(`✅ Health check: ${response.status}`);
    } catch (error) {
      console.log('⚠️ No se pudo hacer health check interno:', error.message);
    }
    
    // Opción 2: Ejecutar una consulta simple a la base de datos
    const userCount = await db.getAllUsers();
    console.log(`✅ Keep-alive ejecutado. Usuarios totales: ${userCount.length}`);
    
    // Opción 3: Enviar un mensaje de log al admin si hay usuarios
    if (ADMIN_CHAT_ID && userCount.length > 0) {
      try {
        const vipUsers = userCount.filter(u => u.vip).length;
        const trialPending = userCount.filter(u => u.trial_requested && !u.trial_received).length;
        
        await bot.telegram.sendMessage(
          ADMIN_CHAT_ID,
          `🤖 Bot activo - ${new Date().toLocaleString('es-ES')}\n` +
          `👥 Usuarios: ${userCount.length}\n` +
          `👑 VIP: ${vipUsers}\n` +
          `⏳ Pruebas pendientes: ${trialPending}\n` +
          `🕐 Último check: ${new Date().toLocaleTimeString('es-ES')}`
        );
      } catch (error) {
        console.log('⚠️ No se pudo enviar mensaje de keep-alive al admin');
      }
    }
    
  } catch (error) {
    console.error('❌ Error en keep-alive:', error.message);
  }
}

// ========== COMANDOS DEL BOT ==========

// Comando /start
bot.start(async (ctx) => {
  try {
    const user = await db.getUser(ctx.from.id);
    const welcomeMessage = `¡Hola ${ctx.from.first_name}! 👋\n\n` +
      `Bienvenido a *VPN Cuba* - Tu solución para conexiones estables y rápidas.\n\n` +
      `🎮 *Prueba gratuita* de 1 hora disponible\n` +
      `💳 *Planes VIP* desde 100 CUP/mes\n` +
      `📱 *Soporte para juegos y aplicaciones*\n` +
      `⚡ *Baja latencia, alta velocidad*\n\n` +
      `¿Qué te gustaría hacer hoy?`;

    const keyboard = Markup.keyboard([
      ['🎮 Prueba Gratuita', '💳 Ver Planes'],
      ['📞 Soporte', 'ℹ️ Información'],
      ['💬 Grupo WhatsApp']
    ]).resize();

    await ctx.replyWithMarkdown(welcomeMessage, keyboard);
    
    // Si es el admin, mostrar opción de admin
    if (ctx.from.id.toString() === ADMIN_CHAT_ID) {
      await ctx.reply(
        '👑 *Modo Administrador Activado*\n' +
        'Puedes acceder al panel de administración en:\n' +
        `${WEBAPP_URL}/admin.html`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (error) {
    console.error('❌ Error en comando start:', error);
    ctx.reply('❌ Ocurrió un error. Por favor, intenta de nuevo.');
  }
});

// Comando /admin (solo para administradores)
bot.command('admin', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID) {
    return ctx.reply('❌ No tienes permisos de administrador.');
  }

  const adminMessage = `👑 *Panel de Administración*\n\n` +
    `Accede al panel completo en:\n` +
    `${WEBAPP_URL}/admin.html\n\n` +
    `Comandos disponibles:\n` +
    `/stats - Ver estadísticas rápidas\n` +
    `/users - Contar usuarios\n` +
    `/pending - Ver pagos pendientes\n` +
    `/trialpending - Ver pruebas pendientes`;

  await ctx.replyWithMarkdown(adminMessage);
});

// Comando /stats (solo para administradores)
bot.command('stats', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID) {
    return ctx.reply('❌ No tienes permisos de administrador.');
  }

  try {
    const stats = await db.getStats();
    const statsMessage = `📊 *Estadísticas del Bot*\n\n` +
      `👥 *Usuarios:* ${stats.users.total}\n` +
      `👑 *VIP:* ${stats.users.vip}\n` +
      `🎮 *Pruebas solicitadas:* ${stats.users.trial_requests}\n` +
      `✅ *Pruebas enviadas:* ${stats.users.trial_received}\n` +
      `⏳ *Pruebas pendientes:* ${stats.users.trial_pending}\n\n` +
      `💰 *Pagos totales:* ${stats.payments.total}\n` +
      `⏳ *Pendientes:* ${stats.payments.pending}\n` +
      `✅ *Aprobados:* ${stats.payments.approved}\n` +
      `❌ *Rechazados:* ${stats.payments.rejected}\n\n` +
      `💵 *Ingresos totales:* ${stats.revenue.total} CUP\n` +
      `📈 *Ingresos hoy:* ${stats.revenue.today} CUP`;

    await ctx.replyWithMarkdown(statsMessage);
  } catch (error) {
    console.error('❌ Error en comando stats:', error);
    ctx.reply('❌ Error al obtener estadísticas.');
  }
});

// Comando /users (solo para administradores)
bot.command('users', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID) {
    return ctx.reply('❌ No tienes permisos de administrador.');
  }

  try {
    const users = await db.getAllUsers();
    const vipUsers = users.filter(u => u.vip).length;
    const trialRequests = users.filter(u => u.trial_requested).length;
    
    const usersMessage = `👥 *Usuarios Registrados*\n\n` +
      `📊 *Total:* ${users.length} usuarios\n` +
      `👑 *VIP:* ${vipUsers}\n` +
      `🎮 *Solicitudes de prueba:* ${trialRequests}\n` +
      `📅 *Hoy:* ${users.filter(u => {
        const today = new Date().toISOString().split('T')[0];
        return u.created_at && u.created_at.startsWith(today);
      }).length} nuevos\n\n` +
      `Para más detalles visita el panel de administración.`;

    await ctx.replyWithMarkdown(usersMessage);
  } catch (error) {
    console.error('❌ Error en comando users:', error);
    ctx.reply('❌ Error al obtener usuarios.');
  }
});

// Comando /pending (solo para administradores)
bot.command('pending', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID) {
    return ctx.reply('❌ No tienes permisos de administrador.');
  }

  try {
    const pendingPayments = await db.getPendingPayments();
    
    if (pendingPayments.length === 0) {
      return ctx.reply('✅ No hay pagos pendientes.');
    }
    
    let pendingMessage = `⏳ *Pagos Pendientes:* ${pendingPayments.length}\n\n`;
    
    // Mostrar solo los primeros 5 para no saturar
    pendingPayments.slice(0, 5).forEach((payment, index) => {
      pendingMessage += `${index + 1}. *ID:* ${payment.id}\n` +
        `   👤 Usuario: ${payment.telegram_id}\n` +
        `   📋 Plan: ${payment.plan}\n` +
        `   💰 Monto: ${payment.price} CUP\n` +
        `   📅 Fecha: ${new Date(payment.created_at).toLocaleDateString('es-ES')}\n\n`;
    });
    
    if (pendingPayments.length > 5) {
      pendingMessage += `... y ${pendingPayments.length - 5} más.\n\n`;
    }
    
    pendingMessage += `Revisa el panel de administración para aprobar/rechazar.`;
    
    await ctx.replyWithMarkdown(pendingMessage);
  } catch (error) {
    console.error('❌ Error en comando pending:', error);
    ctx.reply('❌ Error al obtener pagos pendientes.');
  }
});

// Comando /trialpending (solo para administradores)
bot.command('trialpending', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID) {
    return ctx.reply('❌ No tienes permisos de administrador.');
  }

  try {
    const pendingTrials = await db.getPendingTrials();
    
    if (pendingTrials.length === 0) {
      return ctx.reply('✅ No hay pruebas pendientes.');
    }
    
    let trialsMessage = `🎮 *Pruebas Pendientes:* ${pendingTrials.length}\n\n`;
    
    // Mostrar solo los primeros 5
    pendingTrials.slice(0, 5).forEach((trial, index) => {
      const daysAgo = trial.trial_requested_at ? 
        Math.floor((new Date() - new Date(trial.trial_requested_at)) / (1000 * 60 * 60 * 24)) : 0;
      
      trialsMessage += `${index + 1}. 👤 *${trial.first_name || trial.username || trial.telegram_id}*\n` +
        `   🆔 ID: ${trial.telegram_id}\n` +
        `   🎮 Juego: ${trial.trial_game_server || 'No especificado'}\n` +
        `   📡 Conexión: ${trial.trial_connection_type || 'No especificado'}\n` +
        `   ⏰ Esperando: ${daysAgo} días\n\n`;
    });
    
    if (pendingTrials.length > 5) {
      trialsMessage += `... y ${pendingTrials.length - 5} más.\n\n`;
    }
    
    trialsMessage += `Envía las configuraciones desde el panel de administración.`;
    
    await ctx.replyWithMarkdown(trialsMessage);
  } catch (error) {
    console.error('❌ Error en comando trialpending:', error);
    ctx.reply('❌ Error al obtener pruebas pendientes.');
  }
});

// ========== MANEJADORES DE TEXTO ==========

// Prueba gratuita
bot.hears('🎮 Prueba Gratuita', async (ctx) => {
  try {
    // Verificar elegibilidad
    const eligibility = await db.checkTrialEligibility(ctx.from.id);
    
    if (!eligibility.eligible) {
      return ctx.reply(`❌ *No puedes solicitar una prueba ahora*\n\n${eligibility.reason}`, 
        { parse_mode: 'Markdown' });
    }

    const trialMessage = `🎮 *Prueba Gratuita de 1 Hora*\n\n` +
      `Para configurar tu prueba, necesitamos saber:\n\n` +
      `1️⃣ *¿Para qué juego o servidor la necesitas?*\n` +
      `   Ejemplo: Call of Duty Mobile, Free Fire, Minecraft, etc.\n\n` +
      `2️⃣ *¿Qué tipo de conexión usas?*\n` +
      `   Ejemplo: WiFi de Etecsa, datos móviles, Nauta Hogar, etc.\n\n` +
      `Responde a este mensaje con el siguiente formato:\n\n` +
      `*Juego:* [escribe aquí el juego/servidor]\n` +
      `*Conexión:* [escribe aquí tu tipo de conexión]`;

    await ctx.replyWithMarkdown(trialMessage);
    
    // Guardar que el usuario está en proceso de solicitud de prueba
    ctx.session.waitingForTrialInfo = true;
  } catch (error) {
    console.error('❌ Error en prueba gratuita:', error);
    ctx.reply('❌ Ocurrió un error. Por favor, intenta de nuevo.');
  }
});

// Ver planes
bot.hears('💳 Ver Planes', async (ctx) => {
  const plansMessage = `💳 *Planes Disponibles*\n\n` +
    `*🟢 BÁSICO - 100 CUP/mes*\n` +
    `✅ 1 mes de acceso completo\n` +
    `✅ Soporte para 1 dispositivo\n` +
    `✅ Velocidad completa\n` +
    `✅ Soporte básico\n\n` +
    
    `*🟡 PREMIUM - 180 CUP/2 meses*\n` +
    `✅ 2 meses de acceso completo\n` +
    `✅ Soporte para 2 dispositivos\n` +
    `✅ Velocidad prioritaria\n` +
    `✅ Soporte rápido\n` +
    `✅ Cambio de servidores\n\n` +
    
    `*🔴 VIP - 500 CUP/6 meses*\n` +
    `✅ 6 meses de acceso completo\n` +
    `✅ Soporte para 5 dispositivos\n` +
    `✅ Velocidad máxima\n` +
    `✅ Soporte 24/7\n` +
    `✅ Servidores dedicados\n` +
    `✅ Actualizaciones gratuitas\n\n` +
    
    `*📋 CÓMO COMPRAR:*\n` +
    `1. Elige tu plan\n` +
    `2. Envía el pago por Transfermóvil\n` +
    `3. Envía la captura del pago\n` +
    `4. Recibe tu configuración en minutos\n\n` +
    
    `*💳 DATOS PARA EL PAGO:*\n` +
    `Banco: Banco Metropolitano\n` +
    `Tarjeta: 9208 4501 3476 1852\n` +
    `Nombre: Alejandro Rodríguez`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Comprar Básico', 'plan_basico')],
    [Markup.button.callback('🟡 Comprar Premium', 'plan_premium')],
    [Markup.button.callback('🔴 Comprar VIP', 'plan_vip')],
    [Markup.button.callback('❓ Preguntas Frecuentes', 'faq')]
  ]);

  await ctx.replyWithMarkdown(plansMessage, keyboard);
});

// Soporte
bot.hears('📞 Soporte', async (ctx) => {
  const supportMessage = `📞 *Soporte y Ayuda*\n\n` +
    `¿Necesitas ayuda? Estamos aquí para asistirte:\n\n` +
    `*👤 Soporte Técnico:*\n` +
    `@VPNCubaSupport\n\n` +
    `*📱 WhatsApp:*\n` +
    `+53 12345678\n\n` +
    `*📧 Email:*\n` +
    `soporte@vpn-cuba.com\n\n` +
    `*⏰ Horario de atención:*\n` +
    `Lunes a Domingo: 9:00 AM - 12:00 PM\n\n` +
    `*Problemas comunes:*\n` +
    `• Conexión lenta\n` +
    `• Configuración de servidores\n` +
    `• Renovación de planes\n` +
    `• Problemas con pagos`;

  await ctx.replyWithMarkdown(supportMessage);
});

// Información
bot.hears('ℹ️ Información', async (ctx) => {
  const infoMessage = `ℹ️ *Información sobre VPN Cuba*\n\n` +
    `*🌟 ¿Qué ofrecemos?*\n` +
    `✅ Conexiones VPN estables y rápidas\n` +
    `✅ Soporte para juegos online\n` +
    `✅ Baja latencia y ping\n` +
    `✅ Configuraciones personalizadas\n` +
    `✅ Soporte técnico 24/7\n\n` +
    
    `*🎮 Juegos compatibles:*\n` +
    `• Call of Duty Mobile\n` +
    `• Free Fire\n` +
    `• PUBG Mobile\n` +
    `• Minecraft\n` +
    `• Roblox\n` +
    `• Y muchos más...\n\n` +
    
    `*📱 Aplicaciones compatibles:*\n` +
    `• WhatsApp\n` +
    `• Telegram\n` +
    `• Navegación web\n` +
    `• Streaming\n` +
    `• Videollamadas\n\n` +
    
    `*✅ Garantía de satisfacción:*\n` +
    `Si no estás satisfecho con nuestro servicio en los primeros 3 días, te devolvemos tu dinero.`;

  await ctx.replyWithMarkdown(infoMessage);
});

// Grupo WhatsApp
bot.hears('💬 Grupo WhatsApp', async (ctx) => {
  const whatsappMessage = `💬 *Únete a nuestro grupo de WhatsApp*\n\n` +
    `¡Únete a nuestra comunidad de WhatsApp para estar al día con novedades, ofertas y soporte!\n\n` +
    `*🌟 Beneficios del grupo:*\n` +
    `✅ Notificaciones instantáneas\n` +
    `✅ Soporte comunitario\n` +
    `✅ Anuncios de nuevas funciones\n` +
    `✅ Ofertas exclusivas\n` +
    `✅ Tips y tutoriales\n\n` +
    `*📋 Reglas del grupo:*\n` +
    `• Respeto mutuo\n` +
    `• No spam\n` +
    `• Mantener el tema del VPN\n` +
    `• Compartir experiencias útiles\n\n` +
    `¡Te esperamos! 👇`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('💬 Unirse al Grupo', WHATSAPP_GROUP_URL)]
  ]);

  await ctx.replyWithMarkdown(whatsappMessage, keyboard);
});

// ========== MANEJADORES DE CALLBACK ==========

bot.action('plan_basico', async (ctx) => {
  await handlePlanSelection(ctx, 'basico', 100);
});

bot.action('plan_premium', async (ctx) => {
  await handlePlanSelection(ctx, 'premium', 180);
});

bot.action('plan_vip', async (ctx) => {
  await handlePlanSelection(ctx, 'vip', 500);
});

bot.action('faq', async (ctx) => {
  const faqMessage = `❓ *Preguntas Frecuentes*\n\n` +
    `*1. ¿Cómo funciona el servicio?*\n` +
    `Te enviamos un archivo de configuración que instalas en tu dispositivo. Una vez instalado, tu tráfico pasa por nuestros servidores seguros.\n\n` +
    
    `*2. ¿Es legal usar VPN en Cuba?*\n` +
    `Sí, el uso de VPN es legal en Cuba para fines legítimos como mejorar la conexión y seguridad.\n\n` +
    
    `*3. ¿Funciona con datos móviles?*\n` +
    `Sí, funciona tanto con WiFi como con datos móviles de Etecsa.\n\n` +
    
    `*4. ¿Necesito conocimientos técnicos?*\n` +
    `No, te enviamos instrucciones paso a paso y damos soporte durante la instalación.\n\n` +
    
    `*5. ¿Puedo cambiar de plan después?*\n` +
    `Sí, puedes actualizar tu plan en cualquier momento.\n\n` +
    
    `*6. ¿Ofrecen prueba gratuita?*\n` +
    `Sí, ofrecemos prueba gratuita de 1 hora para que pruebes el servicio.`;

  await ctx.editMessageText(faqMessage, { parse_mode: 'Markdown' });
});

async function handlePlanSelection(ctx, plan, price) {
  try {
    // Guardar en sesión el plan seleccionado
    ctx.session.selectedPlan = plan;
    ctx.session.selectedPrice = price;

    const paymentMessage = `✅ *Has seleccionado el plan ${plan.toUpperCase()}*\n\n` +
      `*💵 Precio:* ${price} CUP\n` +
      `*⏱️ Duración:* ${plan === 'basico' ? '1 mes' : plan === 'premium' ? '2 meses' : '6 meses'}\n\n` +
      
      `*📋 INSTRUCCIONES DE PAGO:*\n\n` +
      `1. Realiza el pago por *Transfermóvil* a:\n` +
      `   ▸ *Banco:* Banco Metropolitano\n` +
      `   ▸ *Tarjeta:* 9208 4501 3476 1852\n` +
      `   ▸ *Nombre:* Alejandro Rodríguez\n\n` +
      
      `2. Toma una *captura de pantalla* del comprobante de pago\n\n` +
      
      `3. Envía la captura aquí en el chat\n\n` +
      
      `4. Recibirás tu configuración en *menos de 5 minutos*\n\n` +
      
      `*⚠️ IMPORTANTE:*\n` +
      `• Asegúrate de que la captura se vea claramente\n` +
      `• Incluye el monto y la referencia\n` +
      `• Si tienes problemas, escribe /cancel y empieza de nuevo`;

    await ctx.editMessageText(paymentMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ Error en selección de plan:', error);
    ctx.reply('❌ Ocurrió un error. Por favor, intenta de nuevo.');
  }
}

// ========== MANEJADOR DE FOTOS (CAPTURAS DE PAGO) ==========

bot.on('photo', async (ctx) => {
  if (!ctx.session.selectedPlan) {
    return ctx.reply('❌ Primero selecciona un plan usando "💳 Ver Planes"');
  }

  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;
    const file = await ctx.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    // Crear directorio temp si no existe
    const tempDir = path.join(__dirname, 'temp');
    try {
      await fs.access(tempDir);
    } catch {
      await fs.mkdir(tempDir, { recursive: true });
    }
    
    // Descargar la imagen
    const response = await fetch(fileUrl);
    const buffer = await response.buffer();
    const fileName = `pago_${ctx.from.id}_${Date.now()}.jpg`;
    const filePath = path.join(tempDir, fileName);
    
    // Guardar temporalmente
    await fs.writeFile(filePath, buffer);
    
    // Subir a Supabase Storage
    const screenshotUrl = await db.uploadImage(filePath, ctx.from.id);
    
    // Crear registro de pago
    const payment = await db.createPayment({
      telegram_id: ctx.from.id,
      plan: ctx.session.selectedPlan,
      price: ctx.session.selectedPrice,
      status: 'pending',
      screenshot_url: screenshotUrl
    });
    
    const confirmationMessage = `✅ *¡Captura recibida!*\n\n` +
      `Hemos recibido tu comprobante de pago para el plan *${ctx.session.selectedPlan.toUpperCase()}*.\n\n` +
      `*📋 Datos del pago:*\n` +
      `▸ ID de pago: #${payment.id}\n` +
      `▸ Monto: ${ctx.session.selectedPrice} CUP\n` +
      `▸ Plan: ${ctx.session.selectedPlan}\n` +
      `▸ Estado: ⏳ *Pendiente de revisión*\n\n` +
      
      `*⏱️ ¿Qué sigue?*\n` +
      `Un administrador revisará tu pago en los próximos minutos y te enviará la configuración.\n\n` +
      
      `*📬 Notificación:*\n` +
      `Recibirás un mensaje cuando tu pago sea aprobado.\n\n` +
      
      `Gracias por confiar en *VPN Cuba*! 🚀`;

    await ctx.replyWithMarkdown(confirmationMessage);
    
    // Notificar al administrador
    if (ADMIN_CHAT_ID) {
      const adminNotification = `🔄 *NUEVO PAGO PENDIENTE*\n\n` +
        `*ID:* #${payment.id}\n` +
        `*Usuario:* ${ctx.from.first_name} ${ctx.from.last_name || ''}\n` +
        `*Username:* @${ctx.from.username || 'sin_usuario'}\n` +
        `*ID Telegram:* ${ctx.from.id}\n` +
        `*Plan:* ${ctx.session.selectedPlan}\n` +
        `*Monto:* ${ctx.session.selectedPrice} CUP\n` +
        `*Fecha:* ${new Date().toLocaleString('es-ES')}\n\n` +
        `Ver en panel: ${WEBAPP_URL}/admin.html`;
      
      await bot.telegram.sendMessage(ADMIN_CHAT_ID, adminNotification, { parse_mode: 'Markdown' });
      
      // También enviar la imagen al admin
      await bot.telegram.sendPhoto(ADMIN_CHAT_ID, fileId, {
        caption: `Captura del pago #${payment.id}`
      });
    }
    
    // Limpiar sesión
    ctx.session.selectedPlan = null;
    ctx.session.selectedPrice = null;
    
    // Eliminar archivo temporal después de 30 segundos
    setTimeout(async () => {
      try {
        await fs.unlink(filePath);
        console.log(`🗑️ Archivo temporal eliminado: ${filePath}`);
      } catch (error) {
        console.error('❌ Error eliminando archivo temporal:', error);
      }
    }, 30000);
    
  } catch (error) {
    console.error('❌ Error procesando pago:', error);
    ctx.reply('❌ Error al procesar tu pago. Por favor, intenta de nuevo o contacta al administrador.');
  }
});

// ========== MANEJADOR DE TEXTO PARA INFORMACIÓN DE PRUEBA ==========

bot.on('text', async (ctx) => {
  if (ctx.session.waitingForTrialInfo) {
    try {
      const message = ctx.message.text;
      
      // Extraer información del mensaje
      const gameMatch = message.match(/[Jj]uego:\s*(.+)/i) || message.match(/[Pp]ara:\s*(.+)/i);
      const connectionMatch = message.match(/[Cc]onexión:\s*(.+)/i) || message.match(/[Cc]onecto:\s*(.+)/i);
      
      const game = gameMatch ? gameMatch[1].trim() : 'No especificado';
      const connection = connectionMatch ? connectionMatch[1].trim() : 'No especificado';
      
      // Guardar solicitud de prueba
      await db.saveUser(ctx.from.id, {
        trial_requested: true,
        trial_plan_type: '1h',
        trial_game_server: game,
        trial_connection_type: connection
      });
      
      const responseMessage = `✅ *¡Solicitud recibida!*\n\n` +
        `Hemos procesado tu solicitud de prueba gratuita.\n\n` +
        `*🎮 Juego/Servidor:* ${game}\n` +
        `*📡 Tipo de Conexión:* ${connection}\n` +
        `*⏰ Duración:* 1 hora\n\n` +
        
        `*⏱️ ¿Qué sigue?*\n` +
        `Un administrador preparará tu configuración personalizada y te la enviará en breve.\n\n` +
        
        `*📬 Notificación:*\n` +
        `Recibirás un mensaje cuando tu configuración esté lista.\n\n` +
        
        `¡Gracias por probar *VPN Cuba*! 🎮`;
      
      await ctx.replyWithMarkdown(responseMessage);
      
      // Notificar al administrador
      if (ADMIN_CHAT_ID) {
        const adminNotification = `🎮 *NUEVA SOLICITUD DE PRUEBA*\n\n` +
          `*Usuario:* ${ctx.from.first_name} ${ctx.from.last_name || ''}\n` +
          `*Username:* @${ctx.from.username || 'sin_usuario'}\n` +
          `*ID Telegram:* ${ctx.from.id}\n` +
          `*🎮 Juego/Servidor:* ${game}\n` +
          `*📡 Conexión:* ${connection}\n` +
          `*⏰ Tipo:* 1 hora\n` +
          `*📅 Fecha:* ${new Date().toLocaleString('es-ES')}\n\n` +
          `Enviar configuración desde: ${WEBAPP_URL}/admin.html`;
        
        await bot.telegram.sendMessage(ADMIN_CHAT_ID, adminNotification, { parse_mode: 'Markdown' });
      }
      
      // Limpiar sesión
      ctx.session.waitingForTrialInfo = false;
      
    } catch (error) {
      console.error('❌ Error procesando solicitud de prueba:', error);
      ctx.reply('❌ Error al procesar tu solicitud. Por favor, intenta de nuevo.');
    }
  }
});

// ========== ENDPOINTS DE API PARA EL PANEL DE ADMINISTRACIÓN ==========

// Middleware para verificar admin
function requireAdmin(req, res, next) {
  const adminId = req.headers['x-admin-id'] || req.query.adminId || req.body.adminId;
  
  if (!adminId || adminId.toString() !== ADMIN_CHAT_ID) {
    return res.status(403).json({ error: 'No autorizado. Solo administradores pueden acceder.' });
  }
  next();
}

// Endpoint para obtener estadísticas
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error en /api/stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas' });
  }
});

// Endpoint para obtener pagos pendientes
app.get('/api/payments/pending', async (req, res) => {
  try {
    const payments = await db.getPendingPayments();
    
    // Obtener información de usuario para cada pago
    const paymentsWithUsers = await Promise.all(
      payments.map(async (payment) => {
        const user = await db.getUser(payment.telegram_id);
        return { ...payment, user };
      })
    );
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error en /api/payments/pending:', error);
    res.status(500).json({ error: 'Error al obtener pagos pendientes' });
  }
});

// Endpoint para obtener pagos aprobados
app.get('/api/payments/approved', async (req, res) => {
  try {
    const payments = await db.getApprovedPayments();
    
    const paymentsWithUsers = await Promise.all(
      payments.map(async (payment) => {
        const user = await db.getUser(payment.telegram_id);
        return { ...payment, user };
      })
    );
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error en /api/payments/approved:', error);
    res.status(500).json({ error: 'Error al obtener pagos aprobados' });
  }
});

// Endpoint para aprobar pago
app.post('/api/payments/:id/approve', requireAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const payment = await db.getPayment(paymentId);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    // Aprobar pago
    const approvedPayment = await db.approvePayment(paymentId);
    
    // Hacer usuario VIP
    await db.makeUserVIP(payment.telegram_id, {
      plan: payment.plan,
      plan_price: payment.price
    });
    
    // Notificar al usuario
    await bot.telegram.sendMessage(
      payment.telegram_id,
      `✅ *¡PAGO APROBADO!*\n\n` +
      `Tu pago *#${paymentId}* ha sido *APROBADO*.\n\n` +
      `*🎉 ¡Felicidades!* Ahora eres usuario *VIP* de VPN Cuba.\n\n` +
      `*📋 Plan:* ${payment.plan.toUpperCase()}\n` +
      `*💰 Monto:* ${payment.price} CUP\n` +
      `*📅 Fecha:* ${new Date().toLocaleDateString('es-ES')}\n\n` +
      `*⏱️ ¿Qué sigue?*\n` +
      `Recibirás tu configuración VIP en los próximos minutos.\n\n` +
      `¡Gracias por confiar en nosotros! 🚀`,
      { parse_mode: 'Markdown' }
    );
    
    res.json({ success: true, payment: approvedPayment });
  } catch (error) {
    console.error('❌ Error en /api/payments/:id/approve:', error);
    res.status(500).json({ error: 'Error al aprobar pago' });
  }
});

// Endpoint para rechazar pago
app.post('/api/payments/:id/reject', requireAdmin, async (req, res) => {
  try {
    const paymentId = req.params.id;
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Debe proporcionar un motivo' });
    }
    
    const payment = await db.getPayment(paymentId);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    // Rechazar pago
    const rejectedPayment = await db.rejectPayment(paymentId, reason);
    
    // Notificar al usuario
    await bot.telegram.sendMessage(
      payment.telegram_id,
      `❌ *PAGO RECHAZADO*\n\n` +
      `Tu pago *#${paymentId}* ha sido *RECHAZADO*.\n\n` +
      `*📋 Motivo:* ${reason}\n\n` +
      `*💡 ¿Qué puedo hacer?*\n` +
      `1. Verifica que hayas enviado el pago correctamente\n` +
      `2. Asegúrate de que la captura sea clara\n` +
      `3. Contacta al soporte si necesitas ayuda\n\n` +
      `*📞 Soporte:* @VPNCubaSupport`,
      { parse_mode: 'Markdown' }
    );
    
    res.json({ success: true, payment: rejectedPayment });
  } catch (error) {
    console.error('❌ Error en /api/payments/:id/reject:', error);
    res.status(500).json({ error: 'Error al rechazar pago' });
  }
});

// Endpoint para enviar configuración (archivo)
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/send-config', upload.single('configFile'), requireAdmin, async (req, res) => {
  try {
    const { paymentId, telegramId, adminId } = req.body;
    const file = req.file;
    
    if (!paymentId || !telegramId || !file) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    
    // Obtener información del pago
    const payment = await db.getPayment(paymentId);
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    // Leer el archivo
    const fileBuffer = await fs.readFile(file.path);
    
    // Enviar archivo al usuario
    await bot.telegram.sendDocument(
      parseInt(telegramId),
      { source: fileBuffer, filename: file.originalname },
      {
        caption: `📁 *CONFIGURACIÓN VPN ENVIADA*\n\n` +
          `Aquí tienes tu configuración para el plan *${payment.plan.toUpperCase()}*.\n\n` +
          `*📋 Instrucciones de instalación:*\n` +
          `1. Descarga este archivo\n` +
          `2. Ábrelo con la aplicación VPN\n` +
          `3. Activa la conexión\n` +
          `4. ¡Disfruta de tu VPN!\n\n` +
          `*🆘 ¿Problemas?*\n` +
          `Contacta a @VPNCubaSupport para ayuda.\n\n` +
          `¡Gracias por tu compra! 🚀`,
        parse_mode: 'Markdown'
      }
    );
    
    // Marcar como enviado en la base de datos
    await db.updatePayment(paymentId, { 
      config_sent: true,
      config_sent_at: new Date().toISOString(),
      config_sent_by: adminId
    });
    
    // Guardar registro del archivo enviado
    await db.saveConfigFile({
      payment_id: paymentId,
      telegram_id: telegramId,
      file_name: file.originalname,
      file_size: file.size,
      sent_by: adminId
    });
    
    // Eliminar archivo temporal
    await fs.unlink(file.path);
    
    res.json({ 
      success: true, 
      message: 'Configuración enviada correctamente',
      paymentId,
      telegramId
    });
    
  } catch (error) {
    console.error('❌ Error en /api/send-config:', error);
    res.status(500).json({ error: 'Error al enviar configuración: ' + error.message });
  }
});

// Endpoint para enviar configuración de prueba
app.post('/api/send-trial-config', upload.single('trialConfigFile'), requireAdmin, async (req, res) => {
  try {
    const { telegramId, adminId, trialType } = req.body;
    const file = req.file;
    
    if (!telegramId || !file) {
      return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    
    // Leer el archivo
    const fileBuffer = await fs.readFile(file.path);
    
    // Enviar archivo al usuario
    await bot.telegram.sendDocument(
      parseInt(telegramId),
      { source: fileBuffer, filename: file.originalname },
      {
        caption: `🎁 *PRUEBA GRATUITA ENVIADA*\n\n` +
          `Aquí tienes tu configuración de prueba de *${trialType || '1 hora'}*.\n\n` +
          `*⏰ Duración:* ${trialType || '1 hora'}\n` +
          `*⚡ Velocidad completa*\n` +
          `*🎮 Compatible con todos los juegos*\n\n` +
          `*📋 Instrucciones:*\n` +
          `1. Descarga este archivo\n` +
          `2. Ábrelo con la aplicación VPN\n` +
          `3. Activa la conexión\n` +
          `4. ¡Disfruta de tu prueba!\n\n` +
          `*💡 Consejo:*\n` +
          `Prueba diferentes servidores para encontrar el mejor ping.\n\n` +
          `¡Esperamos que disfrutes el servicio! 🎮`,
        parse_mode: 'Markdown'
      }
    );
    
    // Marcar prueba como enviada
    await db.markTrialAsSent(telegramId, adminId);
    
    // Eliminar archivo temporal
    await fs.unlink(file.path);
    
    res.json({ 
      success: true, 
      message: 'Prueba enviada correctamente',
      telegramId
    });
    
  } catch (error) {
    console.error('❌ Error en /api/send-trial-config:', error);
    res.status(500).json({ error: 'Error al enviar prueba: ' + error.message });
  }
});

// Endpoint para obtener todos los usuarios
app.get('/api/all-users', async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('❌ Error en /api/all-users:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

// Endpoint para obtener pruebas pendientes
app.get('/api/trials/pending', async (req, res) => {
  try {
    const trials = await db.getPendingTrials();
    
    // Calcular días desde la solicitud
    const trialsWithInfo = trials.map(trial => {
      const daysAgo = trial.trial_requested_at ? 
        Math.floor((new Date() - new Date(trial.trial_requested_at)) / (1000 * 60 * 60 * 24)) : 0;
      
      return {
        ...trial,
        trial_info: {
          days_ago: daysAgo,
          game_server: trial.trial_game_server,
          connection_type: trial.trial_connection_type
        }
      };
    });
    
    res.json(trialsWithInfo);
  } catch (error) {
    console.error('❌ Error en /api/trials/pending:', error);
    res.status(500).json({ error: 'Error al obtener pruebas pendientes' });
  }
});

// Endpoint para estadísticas de pruebas
app.get('/api/trial-stats', async (req, res) => {
  try {
    const stats = await db.getTrialStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error en /api/trial-stats:', error);
    res.status(500).json({ error: 'Error al obtener estadísticas de prueba' });
  }
});

// Endpoint para verificar administrador
app.get('/api/check-admin/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const isAdmin = userId === ADMIN_CHAT_ID;
    
    res.json({ isAdmin });
  } catch (error) {
    console.error('❌ Error en /api/check-admin:', error);
    res.status(500).json({ error: 'Error verificando administrador' });
  }
});

// Endpoint para usuarios activos (últimos 30 días)
app.get('/api/users/active', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const allUsers = await db.getAllUsers();
    const activeUsers = allUsers.filter(user => {
      if (!user.last_activity) return false;
      return new Date(user.last_activity) >= thirtyDaysAgo;
    });
    
    res.json(activeUsers);
  } catch (error) {
    console.error('❌ Error en /api/users/active:', error);
    res.status(500).json({ error: 'Error al obtener usuarios activos' });
  }
});

// Endpoint para enviar mensaje a usuario
app.post('/api/send-message', requireAdmin, async (req, res) => {
  try {
    const { telegramId, message, adminId } = req.body;
    
    if (!telegramId || !message) {
      return res.status(400).json({ error: 'Faltan telegramId o mensaje' });
    }
    
    await bot.telegram.sendMessage(
      parseInt(telegramId),
      `📬 *MENSAJE DEL ADMINISTRADOR*\n\n${message}\n\n` +
      `_Este es un mensaje automático del sistema._`,
      { parse_mode: 'Markdown' }
    );
    
    res.json({ success: true, message: 'Mensaje enviado' });
    
  } catch (error) {
    console.error('❌ Error en /api/send-message:', error);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// Endpoint para remover VIP
app.post('/api/remove-vip', requireAdmin, async (req, res) => {
  try {
    const { telegramId, adminId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: 'Faltan telegramId' });
    }
    
    await db.removeVIP(telegramId);
    
    // Notificar al usuario
    await bot.telegram.sendMessage(
      parseInt(telegramId),
      `ℹ️ *ACTUALIZACIÓN DE ESTADO*\n\n` +
      `Tu estado VIP ha sido removido.\n\n` +
      `*💡 ¿Por qué?*\n` +
      `• Tu plan ha expirado\n` +
      `• O solicitud administrativa\n\n` +
      `*🔄 ¿Cómo renovar?*\n` +
      `Usa "💳 Ver Planes" para adquirir un nuevo plan.\n\n` +
      `*📞 Soporte:* @VPNCubaSupport`,
      { parse_mode: 'Markdown' }
    );
    
    res.json({ success: true, message: 'VIP removido' });
    
  } catch (error) {
    console.error('❌ Error en /api/remove-vip:', error);
    res.status(500).json({ error: 'Error al remover VIP' });
  }
});

// Endpoint de health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    env: process.env.NODE_ENV,
    bot: 'running'
  });
});

// Servir archivos estáticos
app.use(express.static('public'));

// ========== MANEJO DE ERRORES DEL BOT ==========

bot.catch((err, ctx) => {
  console.error(`❌ Error en bot para ${ctx.updateType}:`, err);
  if (ctx.chat) {
    ctx.reply('❌ Ocurrió un error. Por favor, intenta de nuevo.');
  }
});

// ========== INICIAR BOT Y SERVIDOR ==========

async function start() {
  try {
    console.log('🤖 Iniciando bot...');
    
    // Iniciar el bot primero
    await bot.launch();
    console.log('✅ Bot iniciado correctamente');
    
    // Iniciar servidor Express
    const server = app.listen(PORT, () => {
      console.log(`🚀 Servidor escuchando en puerto ${PORT}`);
      console.log(`🌐 URL pública: ${WEBAPP_URL}`);
      console.log(`📊 Panel admin: ${WEBAPP_URL}/admin.html`);
      console.log(`🫀 Health check: ${WEBAPP_URL}/health`);
      
      // Ahora iniciar keep-alive después de que el servidor esté corriendo
      if (process.env.NODE_ENV === 'production' || process.env.ENABLE_KEEP_ALIVE === 'true') {
        console.log('🚀 Iniciando keep-alive cada 5 minutos...');
        setInterval(keepAlive, KEEP_ALIVE_INTERVAL);
        
        // Ejecutar keep-alive después de 10 segundos
        setTimeout(keepAlive, 10000);
      }
    });
    
    // Para evitar que el proceso se cierre por inactividad en Render/railway
    process.on('SIGTERM', () => {
      console.log('🔴 Recibido SIGTERM, cerrando bot...');
      bot.stop('SIGTERM');
      server.close();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('🔴 Recibido SIGINT, cerrando bot...');
      bot.stop('SIGINT');
      server.close();
      process.exit(0);
    });
    
    // Mensaje de inicio al admin
    if (ADMIN_CHAT_ID) {
      setTimeout(async () => {
        try {
          await bot.telegram.sendMessage(
            ADMIN_CHAT_ID,
            `🤖 *Bot VPN Cuba Iniciado*\n\n` +
            `✅ Bot activo y funcionando\n` +
            `🚀 Servidor en puerto ${PORT}\n` +
            `🌐 URL: ${WEBAPP_URL}\n` +
            `📊 Panel: ${WEBAPP_URL}/admin.html\n` +
            `⏰ ${new Date().toLocaleString('es-ES')}\n\n` +
            `¡Sistema listo para recibir solicitudes!`,
            { parse_mode: 'Markdown' }
          );
        } catch (error) {
          console.log('⚠️ No se pudo enviar mensaje de inicio al admin:', error.message);
        }
      }, 5000);
    }
    
  } catch (error) {
    console.error('❌ Error al iniciar:', error);
    process.exit(1);
  }
}

// Iniciar aplicación
start();

// Exportar para pruebas
module.exports = { bot, app };
