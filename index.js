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
  filename: function(req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB para capturas
    files: 1 
  },
  fileFilter: function(req, file, cb) {
    if (file.fieldname === 'screenshot') {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten imágenes JPG, PNG, GIF o WebP'));
      }
    } else if (file.fieldname === 'configFile') {
      if (file.mimetype === 'text/plain' || file.originalname.endsWith('.conf')) {
        cb(null, true);
      } else {
        cb(new Error('Solo se permiten archivos .conf o texto'));
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

// ==================== RUTAS DE LA API ====================

// 1. Verificar si es administrador
app.get('/api/check-admin/:telegramId', function(req, res) {
  const isAdminUser = isAdmin(req.params.telegramId);
  console.log(`🔍 Verificando admin para ${req.params.telegramId}: ${isAdminUser}`);
  res.json({ isAdmin: isAdminUser });
});

// 2. Aceptar términos (usamos localStorage, pero mantenemos para compatibilidad)
app.post('/api/accept-terms', async function(req, res) {
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

    res.json({ success: true, user: user });
  } catch (error) {
    console.error('❌ Error aceptando términos:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 3. Verificar términos aceptados (usamos localStorage, pero mantenemos API)
app.get('/api/check-terms/:telegramId', async function(req, res) {
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
app.post('/api/payment', upload.single('screenshot'), async function(req, res) {
  try {
    console.log('📥 Pago recibido - Datos recibidos:', {
      telegramId: req.body.telegramId,
      plan: req.body.plan,
      price: req.body.price,
      file: req.file ? req.file.filename : 'No file'
    });
    
    const { telegramId, plan, price, notes } = req.body;
    
    if (!telegramId || !plan || !price) {
      console.log('❌ Datos incompletos:', { telegramId: telegramId, plan: plan, price: price });
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
      fs.unlink(req.file.path, function(err) {
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
      payment: payment 
    });
  } catch (error) {
    console.error('❌ Error procesando pago:', error);
    
    // Eliminar archivo si hubo error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, function(err) {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error procesando pago: ' + error.message });
  }
});

// 5. Obtener pagos pendientes
app.get('/api/payments/pending', async function(req, res) {
  try {
    console.log('🔍 Buscando pagos pendientes...');
    const payments = await db.getPendingPayments();
    
    console.log(`📊 Encontrados ${payments.length} pagos pendientes`);
    
    // Obtener información de usuarios para cada pago
    const paymentsWithUsers = await Promise.all(payments.map(async function(payment) {
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
app.get('/api/payments/approved', async function(req, res) {
  try {
    console.log('🔍 Buscando pagos aprobados...');
    const payments = await db.getApprovedPayments();
    
    console.log(`📊 Encontrados ${payments.length} pagos aprobados`);
    
    // Obtener información de usuarios para cada pago
    const paymentsWithUsers = await Promise.all(payments.map(async function(payment) {
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
app.post('/api/payments/:id/approve', async function(req, res) {
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

    res.json({ success: true, payment: payment, user: user });
  } catch (error) {
    console.error('❌ Error aprobando pago:', error);
    res.status(500).json({ error: 'Error aprobando pago' });
  }
});

// 8. Rechazar pago
app.post('/api/payments/:id/reject', async function(req, res) {
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
      console.log(`✅ Usuario ${payment.telegram_id} notificado del rechazo`);
    } catch (botError) {
      console.log('❌ No se pudo notificar al usuario:', botError.message);
    }

    res.json({ success: true, payment: payment });
  } catch (error) {
    console.error('❌ Error rechazando pago:', error);
    res.status(500).json({ error: 'Error rechazando pago' });
  }
});

// 9. Obtener estadísticas
app.get('/api/stats', async function(req, res) {
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
app.get('/api/vip-users', async function(req, res) {
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
app.get('/api/all-users', async function(req, res) {
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
app.get('/api/payments/:id', async function(req, res) {
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

// 13. Enviar archivo de configuración
app.post('/api/send-config', upload.single('configFile'), async function(req, res) {
  try {
    const { paymentId, telegramId, adminId } = req.body;
    
    // Verificar permisos de administrador
    if (!isAdmin(adminId)) {
      console.log(`❌ Intento no autorizado de enviar configuración por ${adminId}`);
      return res.status(403).json({ error: 'No autorizado' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo de configuración requerido' });
    }
    
    // Verificar que el archivo sea .conf
    if (!req.file.originalname.endsWith('.conf')) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, function(err) {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(400).json({ error: 'El archivo debe tener extensión .conf' });
    }
    
    // Obtener información del pago
    const payment = await db.getPayment(paymentId);
    
    if (!payment) {
      // Eliminar archivo subido
      fs.unlink(req.file.path, function(err) {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      return res.status(404).json({ error: 'Pago no encontrado' });
    }
    
    // Verificar que el pago esté aprobado
    if (payment.status !== 'approved') {
      // Eliminar archivo subido
      fs.unlink(req.file.path, function(err) {
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
                  `2. Importa en tu cliente WireGuard\n` +
                  `3. Activa la conexión\n` +
                  `4. ¡Disfruta de baja latencia! 🚀\n\n` +
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
      fs.unlink(req.file.path, function(err) {
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
      fs.unlink(req.file.path, function(err) {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
      res.status(500).json({ error: 'Error enviando archivo por Telegram' });
    }
    
  } catch (error) {
    console.error('❌ Error en send-config:', error);
    
    // Eliminar archivo si hubo error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, function(err) {
        if (err) console.error('❌ Error al eliminar archivo:', err);
      });
    }
    
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// 14. Servir archivos subidos (para fallback si no usa Supabase Storage)
app.use('/uploads', express.static(UPLOADS_DIR));

// 15. Ruta para obtener información del usuario actual
app.get('/api/user-info/:telegramId', async function(req, res) {
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
app.post('/api/send-message', async function(req, res) {
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
app.post('/api/remove-vip', async function(req, res) {
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
    
    res.json({ success: true, message: 'VIP removido', user: user });
  } catch (error) {
    console.error('❌ Error removiendo VIP:', error);
    res.status(500).json({ error: 'Error removiendo VIP' });
  }
});

// 18. Ruta de prueba para verificar que el servidor funciona
app.get('/api/health', function(req, res) {
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
app.get('/api/image/:filename', function(req, res) {
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
app.post('/api/test-payment', async function(req, res) {
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
    res.json({ success: true, message: 'Test payment creado', payment: payment });
  } catch (error) {
    console.error('❌ Error en test payment:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVIR ARCHIVOS HTML ====================

// Ruta principal
app.get('/', function(req, res) {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Ruta para planes
app.get('/plans.html', function(req, res) {
  res.sendFile(path.join(__dirname, 'public/plans.html'));
});

// Ruta para pago
app.get('/payment.html', function(req, res) {
  res.sendFile(path.join(__dirname, 'public/payment.html'));
});

// Ruta para admin
app.get('/admin.html', function(req, res) {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// ==================== BOT DE TELEGRAM ====================

// Comando /start con detección de admin
bot.start(async function(ctx) {
  const userId = ctx.from.id;
  const isAdminUser = isAdmin(userId);
  
  console.log(`🤖 Comando /start de ${userId} (Admin: ${isAdminUser})`);
  
  // Guardar/actualizar usuario en la base de datos
  try {
    await db.saveUser(userId.toString(), {
      telegram_id: userId.toString(),
      username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      created_at: new Date().toISOString()
    });
    console.log(`✅ Usuario ${userId} guardado/actualizado`);
  } catch (error) {
    console.error('❌ Error guardando usuario:', error);
  }
  
  const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}?userId=${userId}`;
  
  // Mensaje de bienvenida personalizado
  let welcomeMessage = `¡Hola ${ctx.from.first_name || 'usuario'}! 👋\n\n`;
  welcomeMessage += `Bienvenido a *VPN Cuba* 🚀\n\n`;
  welcomeMessage += `Conéctate con la mejor latencia para gaming y navegación.\n\n`;
  
  if (isAdminUser) {
    welcomeMessage += `🔧 *Detectado como Administrador*\n`;
    welcomeMessage += `Tienes acceso al panel de administración.\n\n`;
  }
  
  welcomeMessage += `Usa los botones para navegar:`;
  
  // Crear teclado dinámico
  const keyboard = [[
    { text: '🚀 Ver Planes', web_app: { url: webappUrl } }
  ], [
    { text: '📋 Ver Planes', callback_data: 'view_plans' },
    { text: '👑 Mi Estado', callback_data: 'check_status' }
  ]];
  
  // Si es admin, agregar botón de admin
  if (isAdminUser) {
    const adminUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${userId}&admin=true`;
    keyboard.push([{ 
      text: '🔧 Panel Admin', 
      web_app: { url: adminUrl }
    }]);
  }
  
  await ctx.reply(
    welcomeMessage,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
});

// Botón: Ver planes (dentro del bot)
bot.action('view_plans', async function(ctx) {
  console.log(`📋 Usuario ${ctx.from.id} solicita ver planes`);
  
  const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${ctx.from.id}`;
  
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
    `Para comprar, haz clic en Ver Planes`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Ver Planes en WebApp', web_app: { url: webappUrl } }
        ]]
      }
    }
  );
});

// Botón: Ver estado VIP
bot.action('check_status', async function(ctx) {
  console.log(`👑 Usuario ${ctx.from.id} verifica estado VIP`);
  
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
    const webappUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/plans.html?userId=${ctx.from.id}`;
    
    await ctx.editMessageText(
      `❌ *No eres usuario VIP*\n\n` +
      `Aún no tienes acceso a los servicios premium.\n\n` +
      `Haz clic en el botón para ver nuestros planes:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🚀 Ver Planes', web_app: { url: webappUrl } }
          ]]
        }
      }
    );
  }
});

// Comando /comprar
bot.command('comprar', async function(ctx) {
  console.log(`🛒 Usuario ${ctx.from.id} usa /comprar`);
  
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

// Comando /admin solo para admins
bot.command('admin', async function(ctx) {
  if (!isAdmin(ctx.from.id.toString())) {
    console.log(`❌ Usuario ${ctx.from.id} intentó usar /admin sin permisos`);
    return ctx.reply('❌ Solo el administrador puede usar este comando.');
  }

  console.log(`🔧 Admin ${ctx.from.id} usa /admin`);
  
  const adminUrl = `${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html?userId=${ctx.from.id}&admin=true`;
  
  await ctx.reply(
    `🔧 *Panel de Administración*\n\n` +
    `Selecciona una opción:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ 
            text: '📋 Abrir Panel Web', 
            web_app: { url: adminUrl }
          }]
        ]
      }
    }
  );
});

// Comando /enviar para administrador (enviar configuración)
bot.command('enviar', async function(ctx) {
  if (!isAdmin(ctx.from.id.toString())) {
    return ctx.reply('❌ Solo el administrador puede usar este comando.');
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Uso: /enviar <ID de pago o ID de usuario>\nEjemplo: /enviar 123');
  }

  const target = args[1];
  
  console.log(`📤 Admin ${ctx.from.id} intenta enviar configuración a ${target}`);
  
  // Verificar si es un ID de pago o de usuario
  let paymentId, telegramId;
  
  // Asumimos que si es un número corto, es un ID de pago
  if (/^\d+$/.test(target) && target.length < 10) {
    paymentId = target;
    const payment = await db.getPayment(paymentId);
    if (!payment) {
      return ctx.reply(`❌ No se encontró el pago con ID ${paymentId}`);
    }
    telegramId = payment.telegram_id;
  } else {
    // Es un ID de usuario de Telegram
    telegramId = target.replace('@', '');
    // Buscar el último pago aprobado del usuario
    const payments = await db.getUserPayments(telegramId);
    const approvedPayment = payments.find(function(p) { 
      return p.status === 'approved' && !p.config_sent; 
    });
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

  await ctx.reply(`📤 Esperando archivo .conf para enviar al usuario ${telegramId} (Pago ID: ${paymentId})\n\nPor favor, envía el archivo .conf ahora:`);
});

// Manejar archivos enviados por admin
bot.on('document', async function(ctx) {
  if (ctx.session?.waitingForFile && isAdmin(ctx.from.id.toString())) {
    const { target, paymentId } = ctx.session.waitingForFile;
    const fileId = ctx.message.document.file_id;
    const fileName = ctx.message.document.file_name;

    console.log(`📁 Admin ${ctx.from.id} envía archivo ${fileName} a ${target}`);

    try {
      // Verificar que sea un archivo .conf
      if (!fileName.endsWith('.conf')) {
        await ctx.reply('❌ El archivo debe tener extensión .conf');
        return;
      }
      
      // Guardar registro en la base de datos
      await db.saveConfigFile({
        telegram_id: target,
        file_id: fileId,
        file_name: fileName,
        sent_by: ctx.from.username || 'admin',
        sent_at: new Date().toISOString(),
        payment_id: paymentId
      });

      // Actualizar pago
      await db.updatePayment(paymentId, {
        config_sent: true,
        config_sent_at: new Date().toISOString()
      });
      
      // Marcar usuario como VIP
      const user = await db.getUser(target);
      if (user && !user.vip) {
        const payment = await db.getPayment(paymentId);
        await db.makeUserVIP(target, {
          plan: payment.plan,
          plan_price: payment.price,
          vip_since: new Date().toISOString()
        });
      }

      // Enviar al usuario
      await ctx.telegram.sendDocument(target, fileId, {
        caption: '🎉 *¡Tu configuración de VPN Cuba está lista!*\n\n' +
                '📁 Importa este archivo en WireGuard\n' +
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

// Comando /help
bot.command('help', async function(ctx) {
  console.log(`🆘 Usuario ${ctx.from.id} solicita ayuda`);
  
  const keyboard = [[
    { text: '📋 Ver Planes', callback_data: 'view_plans' },
    { text: '👑 Mi Estado', callback_data: 'check_status' }
  ]];
  
  if (isAdmin(ctx.from.id.toString())) {
    keyboard.push([{ text: '🔧 Panel Admin', callback_data: 'admin_panel' }]);
  }
  
  await ctx.reply(
    `🆘 *Ayuda - VPN Cuba*\n\n` +
    `Comandos disponibles:\n` +
    `/start - Iniciar el bot\n` +
    `/plans - Ver planes disponibles\n` +
    `/comprar - Comprar un plan\n` +
    `/status - Verificar tu estado VIP\n` +
    `/help - Mostrar esta ayuda\n\n` +
    `También puedes usar los botones:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    }
  );
});

// ==================== SERVIDOR ====================

// Iniciar servidor
app.listen(PORT, async function() {
  console.log(`🚀 Servidor en http://localhost:${PORT}`);
  console.log(`🤖 Bot Token: ${process.env.BOT_TOKEN ? '✅ Configurado' : '❌ No configurado'}`);
  console.log(`🌐 Supabase URL: ${process.env.SUPABASE_URL ? '✅ Configurado' : '❌ No configurado'}`);
  console.log(`🔑 Supabase Key: ${process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY ? '✅ Configurado' : '❌ No configurado'}`);
  console.log(`👑 Admins configurados: ${ADMIN_IDS.join(', ')}`);
  console.log(`📁 Uploads dir: ${UPLOADS_DIR}`);
  
  // Iniciar bot
  try {
    await bot.launch();
    console.log('🤖 Bot de Telegram iniciado');
    
    // Configurar comandos del bot
    const commands = [
      { command: 'start', description: 'Iniciar el bot' },
      { command: 'plans', description: 'Ver planes disponibles' },
      { command: 'comprar', description: 'Comprar un plan' },
      { command: 'status', description: 'Verificar estado VIP' },
      { command: 'help', description: 'Mostrar ayuda' }
    ];
    
    // Solo mostrar comandos de admin a los admins (no es posible diferenciar)
    await bot.telegram.setMyCommands(commands);
    console.log('📝 Comandos del bot configurados');
    
  } catch (error) {
    console.error('❌ Error iniciando bot:', error);
  }
});

// Manejar cierre
process.on('SIGINT', function() {
  console.log('\n👋 Cerrando aplicación...');
  bot.stop();
  process.exit(0);
});

// Exportar para pruebas
module.exports = {
  app: app,
  isAdmin: isAdmin,
  ADMIN_IDS: ADMIN_IDS
};
