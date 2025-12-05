const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Importar rutas
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const { startBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/css', express.static('css'));

// Crear directorios necesarios
const directories = ['uploads', 'public'];
directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Rutas de la API
app.use('/api', apiRoutes);
app.use('/api/admin', adminRoutes);

// Servir archivos del frontend
const frontendPath = path.join(__dirname, '../frontend');

// Ruta principal (términos)
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Ruta de planes
app.get('/plans.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'plans.html'));
});

// Ruta de pago
app.get('/payment.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'payment.html'));
});

// Ruta de administración
app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin.html'));
});

// Ruta de login de administración
app.get('/admin-login.html', (req, res) => {
    res.sendFile(path.join(frontendPath, 'admin-login.html'));
});

// Ruta para servir archivos de estilo
app.get('/css/style.css', (req, res) => {
    res.sendFile(path.join(frontendPath, 'css/style.css'));
});

// Ruta para servir cualquier archivo del frontend
app.get('/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(frontendPath, filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Archivo no encontrado');
    }
});

// Ruta de salud
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'VPN Cuba Backend',
        version: '1.0.0'
    });
});

// Middleware para manejar errores 404
app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
});

// Middleware para manejar errores
app.use((err, req, res, next) => {
    console.error('Error del servidor:', err);
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'El archivo es demasiado grande' });
    }
    
    res.status(500).json({ 
        error: 'Error interno del servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Iniciar servidor
async function startServer() {
    try {
        // Iniciar bot de Telegram
        await startBot();
        
        // Iniciar servidor HTTP
        app.listen(PORT, () => {
            console.log(`🚀 Servidor iniciado en http://localhost:${PORT}`);
            console.log(`🌐 WebApp disponible en ${process.env.WEBAPP_URL || `http://localhost:${PORT}`}`);
            console.log(`🤖 Bot de Telegram iniciado`);
            console.log(`📊 Panel de admin: ${process.env.WEBAPP_URL || `http://localhost:${PORT}`}/admin.html`);
        });
    } catch (error) {
        console.error('Error al iniciar el servidor:', error);
        process.exit(1);
    }
}

// Iniciar aplicación
startServer();

// Manejar cierre de la aplicación
process.on('SIGINT', () => {
    console.log('\n👋 Cerrando aplicación...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Terminando aplicación...');
    process.exit(0);
});

module.exports = app;
