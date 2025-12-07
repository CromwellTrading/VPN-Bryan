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

// IDs de administradores (separados por comas)
const ADMIN_IDS = process.env.ADMIN_TELEGRAM_IDS ? 
    process.env.ADMIN_TELEGRAM_IDS.split(',').map(id => id.trim()) : 
    ['6373481979', '5376388604'];

// Verificar si es administrador
function isAdmin(userId) {
    return ADMIN_IDS.includes(userId.toString());
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurar multer para subir imágenes y archivos
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB para capturas, 20MB para archivos
    files: 1 
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'screenshot') {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten imágenes JPG, PNG, GIF o WebP'));
      }
    } else if (file.fieldname === 'configFile') {
      // Permitir archivos .zip y .rar
      const allowedExtensions = ['.zip', '.rar'];
      const allowedMimeTypes = [
        'application/zip', 
        'application/x-rar-compressed', 
        'application/x-zip-compressed',
        'application/octet-stream'
      ];
      const fileExt = path.extname(file.originalname).toLowerCase();
      
      if (allowedExtensions.includes(fileExt) || allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten archivos .zip o .rar'));
      }
    } else {
      cb(null, true);
    }
  }
});

// Crear carpetas necesarias
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync('public')) fs.mkdirSync('public', { recursive: true });

// Función auxiliar para nombres de planes
function getPlanName(planType) {
  const plans = {
    'basico': 'Básico (1 mes)',
    'premium': 'Premium (2 meses)',
    'vip': 'VIP (6 meses)'
  };
  return plans[planType] || planType;
}

// ==================== FUNCIONES AUXILIARES DEL BOT ====================

// Función para calcular días restantes según el plan
function calcularDiasRestantes(user) {
    if (!user.vip || !user.vip_since || !user.plan) {
        return 0;
    }

    const fechaInicio = new Date(user.vip_since);
    const fechaActual = new Date();
    
    let duracionDias;
    switch(user.plan.toLowerCase()) {
        case 'basico':
            duracionDias = 30;
            break;
        case 'premium':
            duracionDias = 60;
            break;
        case 'vip':
            duracionDias = 180;
            break;
        default:
            duracionDias = 30;
    }
    
    const fechaExpiracion = new Date(fechaInicio);
    fechaExpiracion.setDate(fechaExpiracion.getDate() + duracionDias);
    
    const diferenciaMs = fechaExpiracion - fechaActual;
    const diasRestantes = Math.max(0, Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24)));
    
    return diasRestantes;
}

// Función para formatear fecha
function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Función para crear menú principal
function crearMenuPrincipal(userId, firstName = 'usuario', esAdmin = false) {
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`;
    const plansUrl = `${webappUrl}/plans.html?userId=${userId}`;
    const adminUrl = `${webappUrl}/admin.html?userId=${userId}&admin=true`;
    
    // Crear teclado BASE para TODOS los usuarios
    const keyboard = [
        [
            { 
                text: '📋 VER PLANES', 
                web_app: { url: plansUrl }
            },
            {
                text: '👑 MI ESTADO',
                callback_data: 'check_status'
            }
        ],
        [
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ]
    ];

    // Si es ADMIN, agregar botones adicionales
    if (esAdmin) {
        keyboard.push([
            { 
                text: '🔧 PANEL ADMIN', 
                web_app: { url: adminUrl }
            },
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }

    return keyboard;
}

// ==================== RUTAS DE LA API ====================

// 1. Verificar si es administrador
app.get('/api/check-admin/:telegramId', (req, res) => {
  const isAdminUser = isAdmin(req.params.telegramId);
  console.log(`🔍 Verificando admin para ${req.params.telegramId}: ${isAdminUser}`);
  res.json({ isAdmin: isAdminUser });
});

// 2. Aceptar términos (usamos localStorage, pero mantenemos para compatibilidad)
app.post('/api/accept-terms', async (req, res) => {
  try {
    const { telegramId, username, firstName } = req.body;
    
    console.log(`✅ Usuario ${telegramId} acepta términos`);
    
    const user = await db.saveUser(telegramId, {
      telegram_id: telegramId,
      username: username,
      first_name: firstName,
      accepted_terms: true,
      terms_date: new Date().toISOString()
    });

    res.json({ success: true, user });
  } catch (error) {
    console.error('❌ Error aceptando términos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 3. Verificar términos aceptados (usamos localStorage, pero mantenemos API)
app.get('/api/check-terms/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    console.log(`🔍 Verificando términos para ${req.params.telegramId}: ${user?.accepted_terms || false}`);
    res.json({ 
      accepted: user?.accepted_terms || false,
      user: user
    });
  } catch (error) {
    console.error('❌ Error verificando términos:', error);
    res.json({ accepted: false });
  }
});

// 4. Procesar pago (CON SUPABASE STORAGE)
app.post('/api/payment', upload.single('screenshot'), async (req, res) => {
  try {
    console.log('📥 Pago recibido - Datos recibidos:', {
      telegramId: req.body.telegramId,
      plan: req.body.plan,
      price: req.body.price,
      file: req.file ? req.file.filename : 'No file'
    });
    
    const { telegramId, plan, price, notes } = req.body;
    
    if (!telegramId || !plan || !price) {
      console.log('❌ Datos incompletos:', { telegramId, plan, price });
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    if (!req.file) {
      console.log('❌ No se recibió captura de pantalla');
      return res.status(400).json({ error: 'Captura de pantalla requerida' });
    }

    // 1. Subir imagen a Supabase Storage
    let screenshotUrl = '';
    try {
      screenshotUrl = await db.uploadImage(req.file.path, telegramId);
      console.log('✅ Imagen subida a Supabase Storage:', screenshotUrl);
      
      // Eliminar archivo local después de subir exitosamente
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error eliminando archivo local:', err);
      });
    } catch (uploadError) {
      console.error('❌ Error subiendo imagen:', uploadError);
      
      // Si falla el upload, usar ruta local como fallback
      screenshotUrl = `/uploads/${req.file.filename}`;
      console.log('⚠️ Usando ruta local como fallback:', screenshotUrl);
    }

    // 2. Obtener información del usuario
    const user = await db.getUser(telegramId);
    const username = user?.username ? `@${user.username}` : 'Sin usuario';
    const firstName = user?.first_name || 'Usuario';

    // 3. Guardar pago en base de datos
    const payment = await db.createPayment({
      telegram_id: telegramId,
      plan: plan,
      price: parseFloat(price),
      screenshot_url: screenshotUrl,
      notes: notes || '',
      status: 'pending',
      created_at: new Date().toISOString()
    });

    if (!payment) {
      throw new Error('No se pudo crear el pago en la base de datos');
    }

    console.log('✅ Pago guardado exitosamente:', {
      paymentId: payment?.id,
      telegramId: telegramId,
      plan: plan
    });

    // 4. 🔥 ENVIAR NOTIFICACIÓN A TODOS LOS ADMINS
    try {
      const adminMessage = `💰 *NUEVO PAGO RECIBIDO*\n\n` +
        `👤 *Usuario:* ${firstName}\n` +
        `📱 *Telegram:* ${username}\n` +
        `🆔 *ID:* ${telegramId}\n` +
        `📋 *Plan:* ${getPlanName(plan)}\n` +
        `💰 *Monto:* $${price} CUP\n` +
        `⏰ *Fecha:* ${new Date().toLocaleString('es-ES')}\n` +
        `📝 *Estado:* ⏳ Pendiente\n\n` +
        `Para revisar, visita el panel de administración.`;
      
      // Enviar a todos los admins
      for (const adminId of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(adminId, adminMessage, { parse_mode: 'Markdown' });
          console.log(`✅ Notificación enviada al admin ${adminId}`);
        } catch (adminError) {
          console.log(`❌ No se pudo notificar al admin ${adminId}:`, adminError.message);
        }
      }
    } catch (adminError) {
      console.log('❌ Error al notificar a los admins:', adminError.message);
    }

    res.json({ 
      success: true, 
      message: 'Pago recibido. Te notificaremos cuando sea aprobado.',
      payment 
    });
  } catch (error) {
    console.error('❌ Error procesando pago:', error);
    
    // Eliminar archivo si hubo error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error procesando pago: ' + error.message });
  }
});

// 5. Obtener pagos pendientes
app.get('/api/payments/pending', async (req, res) => {
  try {
    console.log('🔍 Buscando pagos pendientes...');
    const payments = await db.getPendingPayments();
    
    console.log(`📊 Encontrados ${payments.length} pagos pendientes`);
    
    // Obtener información de usuarios para cada pago
    const paymentsWithUsers = await Promise.all(payments.map(async (payment) => {
      const user = await db.getUser(payment.telegram_id);
      return {
        ...payment,
        user: user || null
      };
    }));
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error obteniendo pagos pendientes:', error);
    res.status(500).json({ error: 'Error obteniendo pagos pendientes' });
  }
});

// 6. Obtener pagos aprobados
app.get('/api/payments/approved', async (req, res) => {
  try {
    console.log('🔍 Buscando pagos aprobados...');
    const payments = await db.getApprovedPayments();
    
    console.log(`📊 Encontrados ${payments.length} pagos aprobados`);
    
    // Obtener información de usuarios para cada pago
    const paymentsWithUsers = await Promise.all(payments.map(async (payment) => {
      const user = await db.getUser(payment.telegram_id);
      return {
        ...payment,
        user: user || null
      };
    }));
    
    res.json(paymentsWithUsers);
  } catch (error) {
    console.error('❌ Error obteniendo pagos aprobados:', error);
    res.status(500).json({ error: 'Error obteniendo pagos aprobados' });
  }
});

// 7. Aprobar pago
app.post('/api/payments/:id/approve', async (req, res) => {
  try {
    console.log(`✅ Aprobando pago ${req.params.id}...`);
    
    const payment = await db.approvePayment(req.params.id);
    
    if (!payment) {
      console.log(`❌ Pago ${req.params.id} no encontrado`);
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    // Obtener usuario
    const user = await db.getUser(payment.telegram_id);
    
    // Notificar al usuario
    try {
      await bot.telegram.sendMessage(
        payment.telegram_id,
        '🎉 *¡Tu pago ha sido aprobado!*\n\n' +
        'Ahora eres usuario VIP de VPN Cuba.\n' +
        'En breve recibirás tu archivo de configuración por este mismo chat.',
        { parse_mode: 'Markdown' }
      );
      console.log(`✅ Usuario ${payment.telegram_id} notificado de aprobación`);
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    res.json({ success: true, payment, user });
  } catch (error) {
    console.error('❌ Error aprobando pago:', error);
    res.status(500).json({ error: 'Error aprobando pago' });
  }
});

// 8. Rechazar pago
app.post('/api/payments/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Se requiere un motivo de rechazo' });
    }

    console.log(`❌ Rechazando pago ${req.params.id} con motivo: ${reason}`);
    
    const payment = await db.rejectPayment(req.params.id, reason);
    
    if (!payment) {
      return res.status(404).json({ error: 'Pago no encontrado' });
    }

    // Notificar al usuario
    try {
      await bot.telegram.sendMessage(
        payment.telegram_id,
        `❌ *Tu pago ha sido rechazado*\n\nMotivo: ${reason}\n\nPor favor, contacta con soporte si necesitas más información.`,
        { parse_mode: 'Markdown' }
      );
      console.log(`✅ Usuario ${payment.telegram_id} notificado del rechazo`);
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    res.json({ success: true, payment });
  } catch (error) {
    console.error('❌ Error rechazando pago:', error);
    res.status(500).json({ error: 'Error rechazando pago' });
  }
});

// 9. Obtener estadísticas
app.get('/api/stats', async (req, res) => {
  try {
    console.log('📊 Obteniendo estadísticas...');
    const stats = await db.getStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// 10. Obtener usuarios VIP
app.get('/api/vip-users', async (req, res) => {
  try {
    console.log('👑 Obteniendo usuarios VIP...');
    const users = await db.getVIPUsers();
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios VIP:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios VIP' });
  }
});

// 11. Obtener todos los usuarios
app.get('/api/all-users', async (req, res) => {
  try {
    console.log('👥 Obteniendo todos los usuarios...');
    const users = await db.getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios' });
  }
});

// 12. Obtener información de un pago específico
app.get('/api/payments/:id', async (req, res) => {
  try {
    console.log(`🔍 Buscando pago ${req.params.id}...`);
    const payment = await db.getPayment(req.params.id);
    
    if (!payment) {
      console.log(`❌ Pago ${req.params.id} no encontrado`);
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    const user = await db.getUser(payment.telegram_id);
    
    res.json({
      ...payment,
      user: user || null
    });
  } catch (error) {
    console.error('❌ Error obteniendo pago:', error);
    res.status(500).json({ error: 'Error obteniendo pago' });
  }
});

// 13. ENVIAR ARCHIVO DE CONFIGURACIÓN (ZIP/RAR) - ACTUALIZADO
app.post('/api/send-config', upload.single('configFile'), async (req, res) => {
  try {
    console.log('📤 Recibiendo archivo de configuración...', {
      body: req.body,
      file: req.file ? req.file.filename : 'No file'
    });
    
    const { paymentId, telegramId, adminId } = req.body;
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de enviar configuración por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    // Verificar que el archivo sea .zip o .rar
    const fileName = req.file.originalname.toLowerCase();
    if (!fileName.endsWith('.zip') && !fileName.endsWith('.rar')) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El archivo debe tener extensión .zip o .rar' });
    }
    
    // Obtener información del pago
    const payment = await db.getPayment(paymentId);
    
    if (!payment) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    // Verificar que el pago esté aprobado
    if (payment.status !== 'approved') {
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El pago no está aprobado' });
    }
    
    try {
      console.log(`📤 Enviando configuración a ${telegramId} (Pago: ${paymentId})`);
      
      // Enviar archivo por Telegram
      await bot.telegram.sendDocument(
        telegramId,
        { source: req.file.path, filename: req.file.originalname },
        {
          caption: `🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n` +
                  `📁 *Archivo:* ${req.file.originalname}\n\n` +
                  `*Instrucciones de instalación:*\n` +
                  `1. Descarga este archivo\n` +
                  `2. Descomprime el ZIP/RAR en tu dispositivo\n` +
                  `3. Importa el archivo .conf en tu cliente WireGuard\n` +
                  `4. Activa la conexión\n` +
                  `5. ¡Disfruta de baja latencia! 🚀\n\n` +
                  `*Soporte:* Contacta con soporte si tienes problemas.`,
          parse_mode: 'Markdown'
        }
      );
      
      // Actualizar pago con información del archivo enviado
      await db.updatePayment(paymentId, {
        config_sent: true,
        config_sent_at: new Date().toISOString(),
        config_file: req.file.filename,
        config_sent_by: adminId
      });
      
      // Marcar usuario como VIP si aún no lo está
      const user = await db.getUser(telegramId);
      if (!user.vip) {
        await db.makeUserVIP(telegramId, {
          plan: payment.plan,
          plan_price: payment.price,
          vip_since: new Date().toISOString()
        });
        console.log(`👑 Usuario ${telegramId} marcado como VIP`);
      }
      
      // Eliminar archivo local después de enviar
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo después de enviar:', err);
      });
      
      console.log(`✅ Configuración enviada a ${telegramId}`);
      
      res.json({ 
        success: true, 
        message: 'Configuración enviada correctamente',
        filename: req.file.filename 
      });
      
    } catch (telegramError) {
      console.error('❌ Error enviando archivo por Telegram:', telegramError);
      // Eliminar archivo subido
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      res.status(500).json({ error: 'Error enviando archivo por Telegram: ' + telegramError.message });
    }
    
  } catch (error) {
    console.error('❌ Error en send-config:', error);
    
    // Eliminar archivo si hubo error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error interno del servidor: ' + error.message });
  }
});

// 14. Servir archivos subidos (para fallback si no usa Supabase Storage)
app.use('/uploads', express.static(UPLOADS_DIR));

// 15. Ruta para obtener información del usuario actual
app.get('/api/user-info/:telegramId', async (req, res) => {
  try {
    const user = await db.getUser(req.params.telegramId);
    
    if (!user) {
      console.log(`❌ Usuario ${req.params.telegramId} no encontrado`);
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Verificar si es admin
    const admin = isAdmin(req.params.telegramId);
    
    res.json({
      ...user,
      isAdmin: admin
    });
  } catch (error) {
    console.error('❌ Error obteniendo información del usuario:', error);
    res.status(500).json({ error: 'Error obteniendo información del usuario' });
  }
});

// 16. Enviar mensaje a usuario (admin)
app.post('/api/send-message', async (req, res) => {
  try {
    const { telegramId, message, adminId } = req.body;
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de enviar mensaje por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log(`📨 Enviando mensaje a ${telegramId}: ${message.substring(0, 50)}...`);
    
    // Enviar mensaje por Telegram
    await bot.telegram.sendMessage(telegramId, `📨 *Mensaje del Administrador:*\n\n${message}`, { 
      parse_mode: 'Markdown' 
    });
    
    console.log(`✅ Mensaje enviado a ${telegramId}`);
    
    res.json({ success: true, message: 'Mensaje enviado' });
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error);
    res.status(500).json({ error: 'Error enviando mensaje: ' + error.message });
  }
});

// 17. Remover VIP de usuario (admin)
app.post('/api/remove-vip', async (req, res) => {
  try {
    const { telegramId, adminId } = req.body;
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de remover VIP por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    console.log(`👑 Removiendo VIP de ${telegramId}...`);
    
    // Remover VIP
    const user = await db.removeVIP(telegramId);
    
    // Notificar al usuario
    try {
      await bot.telegram.sendMessage(
        telegramId,
        '⚠️ *Tu acceso VIP ha sido removido*\n\n' +
        'Tu suscripción VIP ha sido cancelada.\n' +
        'Si crees que es un error, contacta con soporte.',
        { parse_mode: 'Markdown' }
      );
      console.log(`✅ Usuario ${telegramId} notificado de remoción de VIP`);
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }
    
    console.log(`✅ VIP removido de ${telegramId}`);
    
    res.json({ success: true, message: 'VIP removido', user });
  } catch (error) {
    console.error('❌ Error removiendo VIP:', error);
    res.status(500).json({ error: 'Error removiendo VIP' });
  }
});

// 18. Ruta de prueba para verificar que el servidor funciona
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Servidor funcionando correctamente',
    timestamp: new Date().toISOString(),
    admins: ADMIN_IDS,
    port: PORT,
    bot_token: process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado',
    supabase_url: process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado'
  });
});

// 19. Ruta para obtener imagen directa (si está guardada localmente)
app.get('/api/image/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(UPLOADS_DIR, filename);
    
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'Imagen no encontrada' });
    }
  } catch (error) {
    console.error('❌ Error sirviendo imagen:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 20. Ruta de prueba para crear pago
app.post('/api/test-payment', async (req, res) => {
  try {
    console.log('🧪 Test payment recibido:', req.body);
    
    const testPayment = {
      telegram_id: req.body.telegramId || '12345',
      plan: req.body.plan || 'basico',
      price: req.body.price || 800,
      screenshot_url: 'https://via.placeholder.com/300',
      status: 'pending',
      created_at: new Date().toISOString()
    };
    
    const payment = await db.createPayment(testPayment);
    
    console.log('🧪 Test payment creado:', payment);
    res.json({ success: true, message: 'Test payment creado', payment });
  } catch (error) {
    console.error('❌ Error en test payment:', error);
    res.status(500).json({ error: error.message });
  }
});

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

// ==================== BOT DE TELEGRAM - ACTUALIZADO ====================

// Comando /start con todos los botones visibles
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    
    console.log(`🤖 Comando /start de ${userId} (Admin: ${esAdmin})`);
    
    // Guardar/actualizar usuario en la base de datos
    try {
        await db.saveUser(userId.toString(), {
            telegram_id: userId.toString(),
            username: ctx.from.username,
            first_name: firstName,
            last_name: ctx.from.last_name,
            created_at: new Date().toISOString()
        });
        console.log(`✅ Usuario ${userId} guardado/actualizado`);
    } catch (error) {
        console.error('❌ Error guardando usuario:', error);
    }
    
    const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
    
    await ctx.reply(
        `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
        `Conéctate con la mejor latencia para gaming y navegación.\n\n` +
        `${esAdmin ? '🔧 *Eres Administrador* - Tienes acceso a funciones especiales\n\n' : ''}` +
        `*Selecciona una opción:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Menú Principal
bot.action('main_menu', async (ctx) => {
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    
    const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
    
    await ctx.editMessageText(
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Ver Planes (callback)
bot.action('view_plans', async (ctx) => {
    console.log(`📋 Usuario ${ctx.from.id} solicita ver planes`);
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
    
    // Crear teclado específico para planes
    const keyboard = [
        [
            { 
                text: '🚀 VER PLANES EN WEB', 
                web_app: { url: webappUrl }
            }
        ],
        [
            {
                text: '📊 VER DETALLES',
                callback_data: 'view_detailed_plans'
            }
        ],
        [
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    // Si es admin, agregar botón de broadcast
    if (esAdmin) {
        keyboard.splice(3, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `📋 *NUESTROS PLANES* 🚀\n\n` +
        `*BÁSICO (1 mes)*\n` +
        `💵 $800 CUP\n\n` +
        `*PREMIUM (2 meses)*\n` +
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
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Ver Detalles de Planes
bot.action('view_detailed_plans', async (ctx) => {
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
    
    const keyboard = [
        [
            { 
                text: '🚀 COMPRAR AHORA', 
                web_app: { url: webappUrl }
            }
        ],
        [
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '📋 VER PLANES RESUMEN',
                callback_data: 'view_plans'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    if (esAdmin) {
        keyboard.splice(3, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `📊 *DETALLES DE PLANES* 📋\n\n` +
        `*PLAN BÁSICO (1 mes)*\n` +
        `• Precio: $800 CUP\n` +
        `• Conexión de baja latencia\n` +
        `• Ancho de banda ilimitado\n` +
        `• Soporte prioritario\n` +
        `• 10 servidores disponibles\n\n` +
        `*PLAN PREMIUM (2 meses)*\n` +
        `• Precio: $1,300 CUP\n` +
        `• ¡Ahorras $300 CUP!\n` +
        `• Todo lo del Básico\n` +
        `• 2 meses de servicio\n` +
        `• Soporte 24/7\n` +
        `• Protección de datos avanzada\n\n` +
        `*PLAN VIP (6 meses)*\n` +
        `• Precio: $3,000 CUP\n` +
        `• ¡Ahorras $1,800 CUP!\n` +
        `• Solo $500 CUP/mes\n` +
        `• Todo lo del Premium\n` +
        `• 6 meses de servicio\n` +
        `• Configuración personalizada\n` +
        `• Soporte dedicado VIP\n` +
        `• Velocidad máxima garantizada\n\n` +
        `*SELECCIONA UNA OPCIÓN:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Mi Estado (con días restantes)
bot.action('check_status', async (ctx) => {
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    
    console.log(`👑 Usuario ${userId} verifica estado VIP`);
    
    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
            await ctx.editMessageText(
                `❌ *NO ESTÁS REGISTRADO*\n\n` +
                `Usa el botón "📋 VER PLANES" para registrarte y comenzar.\n\n` +
                `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
            return;
        }
        
        if (user?.vip) {
            const vipSince = formatearFecha(user.vip_since);
            const diasRestantes = calcularDiasRestantes(user);
            const planNombre = user.plan ? getPlanName(user.plan) : 'No especificado';
            
            let mensajeEstado = `✅ *¡ERES USUARIO VIP!* 👑\n\n`;
            mensajeEstado += `📅 *Activado:* ${vipSince}\n`;
            mensajeEstado += `📋 *Plan:* ${planNombre}\n`;
            mensajeEstado += `⏳ *Días restantes:* ${diasRestantes} días\n`;
            mensajeEstado += `💰 *Precio:* $${user.plan_price || '0'} CUP\n\n`;
            
            if (diasRestantes <= 7) {
                mensajeEstado += `⚠️ *TU PLAN ESTÁ POR EXPIRAR PRONTO*\n`;
                mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
            } else {
                mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
            }
            
            const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
            const keyboard = [
                [
                    { 
                        text: '🆘 CONTACTAR SOPORTE', 
                        url: 'https://t.me/L0quen2'
                    }
                ],
                [
                    {
                        text: '📋 VER PLANES',
                        web_app: { url: webappUrl }
                    },
                    {
                        text: '🔄 RENOVAR',
                        callback_data: 'view_plans'
                    }
                ],
                [
                    {
                        text: '🏠 MENÚ PRINCIPAL',
                        callback_data: 'main_menu'
                    }
                ]
            ];
            
            if (esAdmin) {
                keyboard.splice(2, 0, [
                    {
                        text: '📢 BROADCAST',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.editMessageText(
                mensajeEstado,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        } else {
            const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
            const keyboard = [
                [
                    { 
                        text: '📋 VER PLANES', 
                        web_app: { url: webappUrl }
                    },
                    {
                        text: '🆘 SOPORTE',
                        url: 'https://t.me/L0quen2'
                    }
                ],
                [
                    {
                        text: '🏠 MENÚ PRINCIPAL',
                        callback_data: 'main_menu'
                    }
                ]
            ];
            
            if (esAdmin) {
                keyboard.splice(1, 0, [
                    {
                        text: '📢 BROADCAST',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.editMessageText(
                `❌ *NO ERES USUARIO VIP*\n\n` +
                `Actualmente no tienes acceso a los servicios premium.\n\n` +
                `Haz clic en los botones para ver nuestros planes o contactar soporte:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        }
    } catch (error) {
        console.error('❌ Error en check_status:', error);
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
        await ctx.editMessageText(
            `❌ Error al verificar tu estado.\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    }
});

// Botón: Iniciar Broadcast (solo admin)
bot.action('start_broadcast', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId)) {
        await ctx.answerCbQuery('❌ NO AUTORIZADO');
        return;
    }
    
    ctx.session = ctx.session || {};
    ctx.session.waitingForBroadcastMessage = true;
    
    await ctx.editMessageText(
        `📢 *ENVIAR MENSAJE A TODOS LOS CLIENTES* 📤\n\n` +
        `Por favor, escribe el mensaje que quieres enviar a *todos* los usuarios registrados.\n\n` +
        `*EJEMPLO:*\n` +
        `¡Hola a todos! 🎉\n` +
        `Tenemos nuevas actualizaciones disponibles...\n\n` +
        `Escribe tu mensaje ahora:`,
        { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '❌ CANCELAR',
                            callback_data: 'main_menu'
                        }
                    ]
                ]
            }
        }
    );
    await ctx.answerCbQuery();
});

// Manejar mensaje de broadcast
bot.on('text', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    const message = ctx.message.text;
    
    if (isAdmin(currentUserId) && ctx.session?.waitingForBroadcastMessage) {
        ctx.session.waitingForBroadcastMessage = false;
        ctx.session.pendingBroadcast = message;
        
        await ctx.reply(
            `📢 *CONFIRMAR ENVÍO DE BROADCAST* ✅\n\n` +
            `*MENSAJE A ENVIAR:*\n${message}\n\n` +
            `Este mensaje será enviado a *todos los usuarios registrados*.\n\n` +
            `¿Estás seguro de que quieres continuar?`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ SÍ, ENVIAR A TODOS', callback_data: 'confirm_broadcast' },
                            { text: '❌ CANCELAR', callback_data: 'main_menu' }
                        ]
                    ]
                }
            }
        );
    }
});

// Botón: Confirmar Broadcast
bot.action('confirm_broadcast', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId)) {
        await ctx.answerCbQuery('❌ NO AUTORIZADO');
        return;
    }
    
    const broadcastMessage = ctx.session?.pendingBroadcast;
    if (!broadcastMessage) {
        await ctx.answerCbQuery('❌ NO HAY MENSAJE PARA ENVIAR');
        return;
    }
    
    try {
        const users = await db.getAllUsers();
        const totalUsers = users.length;
        
        await ctx.editMessageText(
            `📢 *ENVIANDO BROADCAST* 📤\n\n` +
            `Enviando mensaje a ${totalUsers} usuarios...\n` +
            `Por favor, espera. Esto puede tomar unos minutos.\n\n` +
            `⏳ *PROGRESO:* 0/${totalUsers}`,
            { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [] }
            }
        );
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            
            try {
                await bot.telegram.sendMessage(
                    user.telegram_id,
                    `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${broadcastMessage}\n\n_Por favor, no respondas a este mensaje. Para consultas, contacta a soporte: @L0quen2_`,
                    { parse_mode: 'Markdown' }
                );
                successCount++;
                
                if (i % 10 === 0 || i === users.length - 1) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        ctx.callbackQuery.message.message_id,
                        null,
                        `📢 *ENVIANDO BROADCAST* 📤\n\n` +
                        `⏳ *PROGRESO:* ${i + 1}/${totalUsers}\n` +
                        `✅ Enviados: ${successCount}\n` +
                        `❌ Fallados: ${failCount}`,
                        { parse_mode: 'Markdown' }
                    );
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Error enviando broadcast a ${user.telegram_id}:`, error.message);
                failCount++;
            }
        }
        
        delete ctx.session.pendingBroadcast;
        
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, true);
        
        await ctx.editMessageText(
            `✅ *BROADCAST COMPLETADO* 📤\n\n` +
            `📊 *ESTADÍSTICAS:*\n` +
            `• Total de usuarios: ${totalUsers}\n` +
            `• Mensajes enviados: ${successCount}\n` +
            `• Mensajes fallados: ${failCount}\n` +
            `• Tasa de éxito: ${((successCount / totalUsers) * 100).toFixed(1)}%\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
        
    } catch (error) {
        console.error('❌ Error en broadcast:', error);
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, true);
        await ctx.editMessageText(
            `❌ *ERROR EN BROADCAST*\n\n` +
            `Hubo un error al enviar el broadcast: ${error.message}\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    }
});

// Comando /admin solo para admins (mantener por compatibilidad)
bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) {
        console.log(`❌ Usuario ${ctx.from.id} intentó usar /admin sin permisos`);
        return ctx.reply('❌ Solo el administrador puede usar este comando.');
    }

    console.log(`🔧 Admin ${ctx.from.id} usa /admin`);
    
    const adminUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${ctx.from.id}&admin=true`;
    
    const keyboard = [
        [
            { 
                text: '🔧 ABRIR PANEL WEB', 
                web_app: { url: adminUrl }
            }
        ],
        [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ],
        [
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    await ctx.reply(
        `🔧 *PANEL DE ADMINISTRACIÓN*\n\n` +
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /help actualizado
bot.command('help', async (ctx) => {
    console.log(`🆘 Usuario ${ctx.from.id} solicita ayuda`);
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
    
    await ctx.reply(
        `🆘 *AYUDA - VPN CUBA* 🚀\n\n` +
        `Usa los botones para navegar por todas las funciones.\n\n` +
        `*BOTONES DISPONIBLES:*\n` +
        `📋 VER PLANES - Ver y comprar planes\n` +
        `👑 MI ESTADO - Ver tu estado VIP y días restantes\n` +
        `🆘 SOPORTE - Contactar con soporte técnico\n` +
        `${esAdmin ? '🔧 PANEL ADMIN - Panel de administración\n' : ''}` +
        `${esAdmin ? '📢 BROADCAST - Enviar mensaje a todos los usuarios\n' : ''}` +
        `\n¡Todo está disponible en los botones! 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /comprar (mantener por compatibilidad)
bot.command('comprar', async (ctx) => {
    console.log(`🛒 Usuario ${ctx.from.id} usa /comprar`);
    
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${ctx.from.id}`;
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
    
    await ctx.reply(
        `🛒 *PROCESO DE COMPRA*\n\n` +
        `Para realizar tu compra, haz clic en el botón "📋 VER PLANES" en el menú principal.\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /enviar para administrador (mantener por compatibilidad)
bot.command('enviar', async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) {
        return ctx.reply('❌ Solo el administrador puede usar este comando.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Uso: /enviar <ID de pago o ID de usuario>\nEjemplo: /enviar 123');
    }

    const target = args[1];
    
    console.log(`📤 Admin ${ctx.from.id} intenta enviar configuración a ${target}`);
    
    let paymentId, telegramId;
    
    if (/^\d+$/.test(target) && target.length < 10) {
        paymentId = target;
        const payment = await db.getPayment(paymentId);
        if (!payment) {
            return ctx.reply(`❌ No se encontró el pago con ID ${paymentId}`);
        }
        telegramId = payment.telegram_id;
    } else {
        telegramId = target.replace('@', '');
        const payments = await db.getUserPayments(telegramId);
        const approvedPayment = payments.find(p => p.status === 'approved' && !p.config_sent);
        if (!approvedPayment) {
            return ctx.reply(`❌ No se encontró un pago aprobado sin configuración para el usuario ${telegramId}`);
        }
        paymentId = approvedPayment.id;
    }
    
    ctx.session = ctx.session || {};
    ctx.session.waitingForFile = {
        target: telegramId,
        paymentId: paymentId
    };

    await ctx.reply(`📤 Esperando archivo .zip o .rar para enviar al usuario ${telegramId} (Pago ID: ${paymentId})\n\nPor favor, envía el archivo comprimido ahora:`);
});

// Manejar archivos enviados por admin (mantener por compatibilidad)
bot.on('document', async (ctx) => {
    if (ctx.session?.waitingForFile && isAdmin(ctx.from.id.toString())) {
        const { target, paymentId } = ctx.session.waitingForFile;
        const fileId = ctx.message.document.file_id;
        const fileName = ctx.message.document.file_name;

        console.log(`📁 Admin ${ctx.from.id} envía archivo ${fileName} a ${target}`);

        try {
            const fileNameLower = fileName.toLowerCase();
            if (!fileNameLower.endsWith('.zip') && !fileNameLower.endsWith('.rar')) {
                await ctx.reply('❌ El archivo debe tener extensión .zip o .rar');
                return;
            }
            
            await db.saveConfigFile({
                telegram_id: target,
                file_id: fileId,
                file_name: fileName,
                sent_by: ctx.from.username || 'admin',
                sent_at: new Date().toISOString(),
                payment_id: paymentId
            });

            await db.updatePayment(paymentId, {
                config_sent: true,
                config_sent_at: new Date().toISOString()
            });
            
// ==================== BOT DE TELEGRAM - ACTUALIZADO ====================

// Función para calcular días restantes según el plan
function calcularDiasRestantes(user) {
    if (!user.vip || !user.vip_since || !user.plan) {
        return 0;
    }

    const fechaInicio = new Date(user.vip_since);
    const fechaActual = new Date();
    
    let duracionDias;
    switch(user.plan.toLowerCase()) {
        case 'basico':
            duracionDias = 30;
            break;
        case 'premium':
            duracionDias = 60;
            break;
        case 'vip':
            duracionDias = 180;
            break;
        default:
            duracionDias = 30;
    }
    
    const fechaExpiracion = new Date(fechaInicio);
    fechaExpiracion.setDate(fechaExpiracion.getDate() + duracionDias);
    
    const diferenciaMs = fechaExpiracion - fechaActual;
    const diasRestantes = Math.max(0, Math.ceil(diferenciaMs / (1000 * 60 * 60 * 24)));
    
    return diasRestantes;
}

// Función para formatear fecha
function formatearFecha(fecha) {
    return new Date(fecha).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

// Función para crear menú principal
function crearMenuPrincipal(userId, firstName = 'usuario', esAdmin = false) {
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`;
    const plansUrl = `${webappUrl}/plans.html?userId=${userId}`;
    const adminUrl = `${webappUrl}/admin.html?userId=${userId}&admin=true`;
    
    // Crear teclado BASE para TODOS los usuarios
    const keyboard = [
        [
            { 
                text: '📋 VER PLANES', 
                web_app: { url: plansUrl }
            },
            {
                text: '👑 MI ESTADO',
                callback_data: 'check_status'
            }
        ],
        [
            {
                text: '💻 DESCARGAR WIREGUARD',
                callback_data: 'download_wireguard'
            },
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ]
    ];

    // Si es ADMIN, agregar botones adicionales
    if (esAdmin) {
        keyboard.push([
            { 
                text: '🔧 PANEL ADMIN', 
                web_app: { url: adminUrl }
            },
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }

    return keyboard;
}

// Comando /start con todos los botones visibles
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    
    console.log(`🤖 Comando /start de ${userId} (Admin: ${esAdmin})`);
    
    // Guardar/actualizar usuario en la base de datos
    try {
        await db.saveUser(userId.toString(), {
            telegram_id: userId.toString(),
            username: ctx.from.username,
            first_name: firstName,
            last_name: ctx.from.last_name,
            created_at: new Date().toISOString()
        });
        console.log(`✅ Usuario ${userId} guardado/actualizado`);
    } catch (error) {
        console.error('❌ Error guardando usuario:', error);
    }
    
    const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
    
    await ctx.reply(
        `¡Hola ${firstName || 'usuario'}! 👋\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
        `Conéctate con la mejor latencia para gaming y navegación.\n\n` +
        `${esAdmin ? '🔧 *Eres Administrador* - Tienes acceso a funciones especiales\n\n' : ''}` +
        `*Selecciona una opción:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Menú Principal
bot.action('main_menu', async (ctx) => {
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name;
    const esAdmin = isAdmin(userId);
    
    const keyboard = crearMenuPrincipal(userId, firstName, esAdmin);
    
    await ctx.editMessageText(
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀\n\n` +
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Descargar WireGuard
bot.action('download_wireguard', async (ctx) => {
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    
    const keyboard = [
        [
            {
                text: '💻 WINDOWS',
                url: 'https://www.wireguard.com/install/'
            },
            {
                text: '📱 ANDROID',
                url: 'https://play.google.com/store/apps/details?id=com.wireguard.android'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    if (esAdmin) {
        keyboard.splice(1, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `💻 *DESCARGAR WIREGUARD* 📱\n\n` +
        `*Para Windows*\n` +
        `Aplicación Oficial de WireGuard para Windows:\n` +
        `Descargue el instalador (archivo .msi) directamente desde la web oficial.\n` +
        `Enlace: https://www.wireguard.com/install/\n` +
        `(Busque la sección de Windows en el enlace para el archivo de descarga más reciente).\n\n` +
        `*Para Android*\n` +
        `Aplicación Oficial de WireGuard en Google Play Store:\n` +
        `Instálela directamente desde la tienda de aplicaciones de Google.\n` +
        `Enlace: https://play.google.com/store/apps/details?id=com.wireguard.android\n\n` +
        `*Selecciona tu sistema operativo:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Ver Planes (callback)
bot.action('view_plans', async (ctx) => {
    console.log(`📋 Usuario ${ctx.from.id} solicita ver planes`);
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
    
    // Crear teclado específico para planes
    const keyboard = [
        [
            { 
                text: '🚀 VER PLANES EN WEB', 
                web_app: { url: webappUrl }
            }
        ],
        [
            {
                text: '📊 VER DETALLES',
                callback_data: 'view_detailed_plans'
            }
        ],
        [
            {
                text: '💻 DESCARGAR WIREGUARD',
                callback_data: 'download_wireguard'
            },
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    // Si es admin, agregar botón de broadcast
    if (esAdmin) {
        keyboard.splice(3, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `📋 *NUESTROS PLANES* 🚀\n\n` +
        `*BÁSICO (1 mes)*\n` +
        `💵 $800 CUP\n\n` +
        `*PREMIUM (2 meses)*\n` +
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
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Ver Detalles de Planes
bot.action('view_detailed_plans', async (ctx) => {
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
    
    const keyboard = [
        [
            { 
                text: '🚀 COMPRAR AHORA', 
                web_app: { url: webappUrl }
            }
        ],
        [
            {
                text: '💻 DESCARGAR WIREGUARD',
                callback_data: 'download_wireguard'
            },
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '📋 VER PLANES RESUMEN',
                callback_data: 'view_plans'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    if (esAdmin) {
        keyboard.splice(3, 0, [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ]);
    }
    
    await ctx.editMessageText(
        `📊 *DETALLES DE PLANES* 📋\n\n` +
        `*PLAN BÁSICO (1 mes)*\n` +
        `• Precio: $800 CUP\n` +
        `• Conexión de baja latencia\n` +
        `• Ancho de banda ilimitado\n` +
        `• Soporte prioritario\n` +
        `• 10 servidores disponibles\n\n` +
        `*PLAN PREMIUM (2 meses)*\n` +
        `• Precio: $1,300 CUP\n` +
        `• ¡Ahorras $300 CUP!\n` +
        `• Todo lo del Básico\n` +
        `• 2 meses de servicio\n` +
        `• Soporte 24/7\n` +
        `• Protección de datos avanzada\n\n` +
        `*PLAN VIP (6 meses)*\n` +
        `• Precio: $3,000 CUP\n` +
        `• ¡Ahorras $1,800 CUP!\n` +
        `• Solo $500 CUP/mes\n` +
        `• Todo lo del Premium\n` +
        `• 6 meses de servicio\n` +
        `• Configuración personalizada\n` +
        `• Soporte dedicado VIP\n` +
        `• Velocidad máxima garantizada\n\n` +
        `*SELECCIONA UNA OPCIÓN:*`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Botón: Mi Estado (con días restantes)
bot.action('check_status', async (ctx) => {
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    
    console.log(`👑 Usuario ${userId} verifica estado VIP`);
    
    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
            await ctx.editMessageText(
                `❌ *NO ESTÁS REGISTRADO*\n\n` +
                `Usa el botón "📋 VER PLANES" para registrarte y comenzar.\n\n` +
                `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
            return;
        }
        
        if (user?.vip) {
            const vipSince = formatearFecha(user.vip_since);
            const diasRestantes = calcularDiasRestantes(user);
            const planNombre = user.plan ? getPlanName(user.plan) : 'No especificado';
            
            let mensajeEstado = `✅ *¡ERES USUARIO VIP!* 👑\n\n`;
            mensajeEstado += `📅 *Activado:* ${vipSince}\n`;
            mensajeEstado += `📋 *Plan:* ${planNombre}\n`;
            mensajeEstado += `⏳ *Días restantes:* ${diasRestantes} días\n`;
            mensajeEstado += `💰 *Precio:* $${user.plan_price || '0'} CUP\n\n`;
            
            if (diasRestantes <= 7) {
                mensajeEstado += `⚠️ *TU PLAN ESTÁ POR EXPIRAR PRONTO*\n`;
                mensajeEstado += `Renueva ahora para mantener tu acceso VIP.\n\n`;
            } else {
                mensajeEstado += `Tu acceso está activo. ¡Disfruta de baja latencia! 🚀\n\n`;
            }
            
            const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
            const keyboard = [
                [
                    { 
                        text: '📋 VER PLANES',
                        web_app: { url: webappUrl }
                    },
                    {
                        text: '💻 DESCARGAR WIREGUARD',
                        callback_data: 'download_wireguard'
                    }
                ],
                [
                    {
                        text: '🆘 CONTACTAR SOPORTE', 
                        url: 'https://t.me/L0quen2'
                    }
                ],
                [
                    {
                        text: '🏠 MENÚ PRINCIPAL',
                        callback_data: 'main_menu'
                    }
                ]
            ];
            
            if (esAdmin) {
                keyboard.splice(2, 0, [
                    {
                        text: '📢 BROADCAST',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.editMessageText(
                mensajeEstado,
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        } else {
            const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${userId}`;
            const keyboard = [
                [
                    { 
                        text: '📋 VER PLANES', 
                        web_app: { url: webappUrl }
                    },
                    {
                        text: '💻 DESCARGAR WIREGUARD',
                        callback_data: 'download_wireguard'
                    }
                ],
                [
                    {
                        text: '🆘 SOPORTE',
                        url: 'https://t.me/L0quen2'
                    }
                ],
                [
                    {
                        text: '🏠 MENÚ PRINCIPAL',
                        callback_data: 'main_menu'
                    }
                ]
            ];
            
            if (esAdmin) {
                keyboard.splice(2, 0, [
                    {
                        text: '📢 BROADCAST',
                        callback_data: 'start_broadcast'
                    }
                ]);
            }
            
            await ctx.editMessageText(
                `❌ *NO ERES USUARIO VIP*\n\n` +
                `Actualmente no tienes acceso a los servicios premium.\n\n` +
                `Haz clic en los botones para ver nuestros planes o descargar WireGuard:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
        }
    } catch (error) {
        console.error('❌ Error en check_status:', error);
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
        await ctx.editMessageText(
            `❌ Error al verificar tu estado.\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    }
});

// Botón: Iniciar Broadcast (solo admin)
bot.action('start_broadcast', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId)) {
        await ctx.answerCbQuery('❌ NO AUTORIZADO');
        return;
    }
    
    ctx.session = ctx.session || {};
    ctx.session.waitingForBroadcastMessage = true;
    
    await ctx.editMessageText(
        `📢 *ENVIAR MENSAJE A TODOS LOS CLIENTES* 📤\n\n` +
        `Por favor, escribe el mensaje que quieres enviar a *todos* los usuarios registrados.\n\n` +
        `*EJEMPLO:*\n` +
        `¡Hola a todos! 🎉\n` +
        `Tenemos nuevas actualizaciones disponibles...\n\n` +
        `Escribe tu mensaje ahora:`,
        { 
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '❌ CANCELAR',
                            callback_data: 'main_menu'
                        }
                    ]
                ]
            }
        }
    );
    await ctx.answerCbQuery();
});

// Manejar mensaje de broadcast
bot.on('text', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    const message = ctx.message.text;
    
    if (isAdmin(currentUserId) && ctx.session?.waitingForBroadcastMessage) {
        ctx.session.waitingForBroadcastMessage = false;
        ctx.session.pendingBroadcast = message;
        
        await ctx.reply(
            `📢 *CONFIRMAR ENVÍO DE BROADCAST* ✅\n\n` +
            `*MENSAJE A ENVIAR:*\n${message}\n\n` +
            `Este mensaje será enviado a *todos los usuarios registrados*.\n\n` +
            `¿Estás seguro de que quieres continuar?`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ SÍ, ENVIAR A TODOS', callback_data: 'confirm_broadcast' },
                            { text: '❌ CANCELAR', callback_data: 'main_menu' }
                        ]
                    ]
                }
            }
        );
    }
});

// Botón: Confirmar Broadcast
bot.action('confirm_broadcast', async (ctx) => {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId)) {
        await ctx.answerCbQuery('❌ NO AUTORIZADO');
        return;
    }
    
    const broadcastMessage = ctx.session?.pendingBroadcast;
    if (!broadcastMessage) {
        await ctx.answerCbQuery('❌ NO HAY MENSAJE PARA ENVIAR');
        return;
    }
    
    try {
        const users = await db.getAllUsers();
        const totalUsers = users.length;
        
        await ctx.editMessageText(
            `📢 *ENVIANDO BROADCAST* 📤\n\n` +
            `Enviando mensaje a ${totalUsers} usuarios...\n` +
            `Por favor, espera. Esto puede tomar unos minutos.\n\n` +
            `⏳ *PROGRESO:* 0/${totalUsers}`,
            { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [] }
            }
        );
        
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            
            try {
                await bot.telegram.sendMessage(
                    user.telegram_id,
                    `📢 *MENSAJE IMPORTANTE - VPN CUBA*\n\n${broadcastMessage}\n\n_Por favor, no respondas a este mensaje. Para consultas, contacta a soporte: @L0quen2_`,
                    { parse_mode: 'Markdown' }
                );
                successCount++;
                
                if (i % 10 === 0 || i === users.length - 1) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        ctx.callbackQuery.message.message_id,
                        null,
                        `📢 *ENVIANDO BROADCAST* 📤\n\n` +
                        `⏳ *PROGRESO:* ${i + 1}/${totalUsers}\n` +
                        `✅ Enviados: ${successCount}\n` +
                        `❌ Fallados: ${failCount}`,
                        { parse_mode: 'Markdown' }
                    );
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Error enviando broadcast a ${user.telegram_id}:`, error.message);
                failCount++;
            }
        }
        
        delete ctx.session.pendingBroadcast;
        
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, true);
        
        await ctx.editMessageText(
            `✅ *BROADCAST COMPLETADO* 📤\n\n` +
            `📊 *ESTADÍSTICAS:*\n` +
            `• Total de usuarios: ${totalUsers}\n` +
            `• Mensajes enviados: ${successCount}\n` +
            `• Mensajes fallados: ${failCount}\n` +
            `• Tasa de éxito: ${((successCount / totalUsers) * 100).toFixed(1)}%\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
        
    } catch (error) {
        console.error('❌ Error en broadcast:', error);
        const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, true);
        await ctx.editMessageText(
            `❌ *ERROR EN BROADCAST*\n\n` +
            `Hubo un error al enviar el broadcast: ${error.message}\n\n` +
            `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            }
        );
    }
});

// Comando /admin solo para admins (mantener por compatibilidad)
bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) {
        console.log(`❌ Usuario ${ctx.from.id} intentó usar /admin sin permisos`);
        return ctx.reply('❌ Solo el administrador puede usar este comando.');
    }

    console.log(`🔧 Admin ${ctx.from.id} usa /admin`);
    
    const adminUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${ctx.from.id}&admin=true`;
    
    const keyboard = [
        [
            { 
                text: '🔧 ABRIR PANEL WEB', 
                web_app: { url: adminUrl }
            }
        ],
        [
            {
                text: '💻 DESCARGAR WIREGUARD',
                callback_data: 'download_wireguard'
            },
            {
                text: '🆘 SOPORTE',
                url: 'https://t.me/L0quen2'
            }
        ],
        [
            {
                text: '📢 BROADCAST',
                callback_data: 'start_broadcast'
            }
        ],
        [
            {
                text: '🏠 MENÚ PRINCIPAL',
                callback_data: 'main_menu'
            }
        ]
    ];
    
    await ctx.reply(
        `🔧 *PANEL DE ADMINISTRACIÓN*\n\n` +
        `Selecciona una opción:`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /help actualizado
bot.command('help', async (ctx) => {
    console.log(`🆘 Usuario ${ctx.from.id} solicita ayuda`);
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
    
    await ctx.reply(
        `🆘 *AYUDA - VPN CUBA* 🚀\n\n` +
        `Usa los botones para navegar por todas las funciones.\n\n` +
        `*BOTONES DISPONIBLES:*\n` +
        `📋 VER PLANES - Ver y comprar planes\n` +
        `👑 MI ESTADO - Ver tu estado VIP y días restantes\n` +
        `💻 DESCARGAR WIREGUARD - Instrucciones de instalación\n` +
        `🆘 SOPORTE - Contactar con soporte técnico\n` +
        `${esAdmin ? '🔧 PANEL ADMIN - Panel de administración\n' : ''}` +
        `${esAdmin ? '📢 BROADCAST - Enviar mensaje a todos los usuarios\n' : ''}` +
        `\n¡Todo está disponible en los botones! 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /comprar (mantener por compatibilidad)
bot.command('comprar', async (ctx) => {
    console.log(`🛒 Usuario ${ctx.from.id} usa /comprar`);
    
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${ctx.from.id}`;
    
    const userId = ctx.from.id.toString();
    const esAdmin = isAdmin(userId);
    const keyboard = crearMenuPrincipal(userId, ctx.from.first_name, esAdmin);
    
    await ctx.reply(
        `🛒 *PROCESO DE COMPRA*\n\n` +
        `Para realizar tu compra, haz clic en el botón "📋 VER PLANES" en el menú principal.\n\n` +
        `*VPN CUBA - MENÚ PRINCIPAL* 🚀`,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        }
    );
});

// Comando /enviar para administrador (mantener por compatibilidad)
bot.command('enviar', async (ctx) => {
    if (!isAdmin(ctx.from.id.toString())) {
        return ctx.reply('❌ Solo el administrador puede usar este comando.');
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('Uso: /enviar <ID de pago o ID de usuario>\nEjemplo: /enviar 123');
    }

    const target = args[1];
    
    console.log(`📤 Admin ${ctx.from.id} intenta enviar configuración a ${target}`);
    
    let paymentId, telegramId;
    
    if (/^\d+$/.test(target) && target.length < 10) {
        paymentId = target;
        const payment = await db.getPayment(paymentId);
        if (!payment) {
            return ctx.reply(`❌ No se encontró el pago con ID ${paymentId}`);
        }
        telegramId = payment.telegram_id;
    } else {
        telegramId = target.replace('@', '');
        const payments = await db.getUserPayments(telegramId);
        const approvedPayment = payments.find(p => p.status === 'approved' && !p.config_sent);
        if (!approvedPayment) {
            return ctx.reply(`❌ No se encontró un pago aprobado sin configuración para el usuario ${telegramId}`);
        }
        paymentId = approvedPayment.id;
    }
    
    ctx.session = ctx.session || {};
    ctx.session.waitingForFile = {
        target: telegramId,
        paymentId: paymentId
    };

    await ctx.reply(`📤 Esperando archivo .zip o .rar para enviar al usuario ${telegramId} (Pago ID: ${paymentId})\n\nPor favor, envía el archivo comprimido ahora:`);
});

// Manejar archivos enviados por admin (mantener por compatibilidad)
bot.on('document', async (ctx) => {
    if (ctx.session?.waitingForFile && isAdmin(ctx.from.id.toString())) {
        const { target, paymentId } = ctx.session.waitingForFile;
        const fileId = ctx.message.document.file_id;
        const fileName = ctx.message.document.file_name;

        console.log(`📁 Admin ${ctx.from.id} envía archivo ${fileName} a ${target}`);

        try {
            const fileNameLower = fileName.toLowerCase();
            if (!fileNameLower.endsWith('.zip') && !fileNameLower.endsWith('.rar')) {
                await ctx.reply('❌ El archivo debe tener extensión .zip o .rar');
                return;
            }
            
            await db.saveConfigFile({
                telegram_id: target,
                file_id: fileId,
                file_name: fileName,
                sent_by: ctx.from.username || 'admin',
                sent_at: new Date().toISOString(),
                payment_id: paymentId
            });

            await db.updatePayment(paymentId, {
                config_sent: true,
                config_sent_at: new Date().toISOString()
            });
            
            const user = await db.getUser(target);
            if (user && !user.vip) {
                const payment = await db.getPayment(paymentId);
                await db.makeUserVIP(target, {
                    plan: payment.plan,
                    plan_price: payment.price,
                    vip_since: new Date().toISOString()
                });
            }

            await ctx.telegram.sendDocument(target, fileId, {
                caption: '🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n' +
                        '📁 Descomprime este archivo ZIP/RAR\n' +
                        '📄 Importa el archivo .conf en WireGuard\n' +
                        '🚀 ¡Disfruta de baja latencia!',
                parse_mode: 'Markdown'
            });

            await ctx.reply(`✅ Archivo enviado al usuario ${target}`);
        } catch (error) {
            console.error('❌ Error enviando archivo:', error);
            await ctx.reply(`❌ Error enviando archivo: ${error.message}`);
        }

        delete ctx.session.waitingForFile;
    }
});

// ==================== SERVIDOR ====================

// Iniciar servidor
app.listen(PORT, async () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`🤖 Bot Token: ${process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🌐 Supabase URL: ${process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`🔑 Supabase Key: ${process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY ? '✅ Configurado' : '❌ No configurado'}`);
    console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
    console.log(`📁 Uploads dir: ${UPLOADS_DIR}`);
    console.log(`🆘 Soporte: @L0quen2`);
    console.log(`📢 Broadcast: Disponible para admins`);
    
    // Iniciar bot
    try {
        await bot.launch();
        console.log('🤖 Bot de Telegram iniciado');
        
        // Configurar comandos del bot
        const commands = [
            { command: 'start', description: 'Iniciar el bot' },
            { command: 'help', description: 'Mostrar ayuda' }
        ];
        
        await bot.telegram.setMyCommands(commands);
        console.log('📝 Comandos del bot configurados');
        
    } catch (error) {
        console.error('❌ Error iniciando bot:', error);
    }

    // Iniciar keep-alive
    startKeepAlive();
});

// Manejar cierre
process.on('SIGINT', () => {
    console.log('\n👋 Cerrando aplicación...');
    bot.stop();
    process.exit(0);
});

// ==================== KEEP ALIVE ====================

// Función para hacer ping a la propia aplicación cada 5 minutos
function startKeepAlive() {
    const keepAliveInterval = 5 * 60 * 1000; // 5 minutos en milisegundos
    const healthCheckUrl = `http://localhost:${PORT}/api/health`;

    setInterval(async () => {
        try {
            const response = await fetch(healthCheckUrl);
            if (response.ok) {
                console.log(`✅ Keep-alive ping exitoso a las ${new Date().toLocaleTimeString()}`);
            } else {
                console.error(`❌ Keep-alive ping falló con estado ${response.status}`);
            }
        } catch (error) {
            console.error('❌ Error en keep-alive ping:', error.message);
        }
    }, keepAliveInterval);

    console.log(`🔄 Keep-alive iniciado. Ping cada 5 minutos a ${healthCheckUrl}`);
}

// Si usas una versión de Node.js anterior a la 18 (que no tiene fetch nativo), usa esta versión:
// function startKeepAlive() {
//   const keepAliveInterval = 5 * 60 * 1000; // 5 minutos en milisegundos
//   const http = require('http');
//   const healthCheckUrl = `http://localhost:${PORT}/api/health`;

//   setInterval(() => {
//     const req = http.request(healthCheckUrl, (res) => {
//       if (res.statusCode === 200) {
//         console.log(`✅ Keep-alive ping exitoso a las ${new Date().toLocaleTimeString()}`);
//       } else {
//         console.error(`❌ Keep-alive ping falló con estado ${res.statusCode}`);
//       }
//     });

//     req.on('error', (error) => {
//       console.error('❌ Error en keep-alive ping:', error.message);
//     });

//     req.end();
//   }, keepAliveInterval);

//   console.log(`🔄 Keep-alive iniciado. Ping cada 5 minutos a ${healthCheckUrl}`);
// }

// Exportar para pruebas
module.exports = {
    app,
    isAdmin,
    ADMIN_IDS
};
