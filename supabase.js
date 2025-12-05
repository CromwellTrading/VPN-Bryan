const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Cliente para operaciones públicas
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente para operaciones administrativas (usa service role key)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Funciones auxiliares para usuarios
const userService = {
    // Crear o actualizar usuario
    async upsertUser(telegramId, userData) {
        try {
            const { data, error } = await supabaseAdmin
                .from('users')
                .upsert({
                    telegram_id: telegramId,
                    ...userData,
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'telegram_id'
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en upsertUser:', error);
            throw error;
        }
    },

    // Obtener usuario por telegramId
    async getUserByTelegramId(telegramId) {
        try {
            const { data, error } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('telegram_id', telegramId)
                .single();

            if (error && error.code !== 'PGRST116') throw error;
            return data;
        } catch (error) {
            console.error('Error en getUserByTelegramId:', error);
            throw error;
        }
    },

    // Verificar si usuario aceptó términos
    async hasAcceptedTerms(telegramId) {
        try {
            const user = await this.getUserByTelegramId(telegramId);
            return user?.accepted_terms || false;
        } catch (error) {
            console.error('Error en hasAcceptedTerms:', error);
            return false;
        }
    },

    // Actualizar usuario a VIP
    async setUserVIP(telegramId, plan, price) {
        try {
            const { data, error } = await supabaseAdmin
                .from('users')
                .update({
                    vip: true,
                    vip_since: new Date().toISOString(),
                    plan: plan,
                    plan_price: price
                })
                .eq('telegram_id', telegramId)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en setUserVIP:', error);
            throw error;
        }
    },

    // Obtener todos los usuarios VIP
    async getVIPUsers() {
        try {
            const { data, error } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('vip', true)
                .order('vip_since', { ascending: false });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en getVIPUsers:', error);
            throw error;
        }
    },

    // Buscar usuario por ID o username
    async searchUser(query) {
        try {
            const { data, error } = await supabaseAdmin
                .from('users')
                .select('*')
                .or(`telegram_id.ilike.%${query}%,username.ilike.%${query}%,first_name.ilike.%${query}%`)
                .limit(5);

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en searchUser:', error);
            throw error;
        }
    }
};

// Funciones auxiliares para pagos
const paymentService = {
    // Crear nuevo pago
    async createPayment(paymentData) {
        try {
            const { data, error } = await supabaseAdmin
                .from('payments')
                .insert(paymentData)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en createPayment:', error);
            throw error;
        }
    },

    // Obtener pagos pendientes
    async getPendingPayments() {
        try {
            const { data, error } = await supabaseAdmin
                .from('payments')
                .select('*')
                .eq('status', 'pending')
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en getPendingPayments:', error);
            throw error;
        }
    },

    // Aprobar pago
    async approvePayment(paymentId, adminNotes = '') {
        try {
            const { data, error } = await supabaseAdmin
                .from('payments')
                .update({
                    status: 'approved',
                    admin_notes: adminNotes,
                    updated_at: new Date().toISOString()
                })
                .eq('id', paymentId)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en approvePayment:', error);
            throw error;
        }
    },

    // Rechazar pago
    async rejectPayment(paymentId, reason) {
        try {
            const { data, error } = await supabaseAdmin
                .from('payments')
                .update({
                    status: 'rejected',
                    admin_notes: reason,
                    updated_at: new Date().toISOString()
                })
                .eq('id', paymentId)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en rejectPayment:', error);
            throw error;
        }
    },

    // Buscar pagos
    async searchPayments(query) {
        try {
            const { data, error } = await supabaseAdmin
                .from('payments')
                .select('*')
                .or(`telegram_id.ilike.%${query}%,plan.ilike.%${query}%,id.ilike.%${query}%`)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en searchPayments:', error);
            throw error;
        }
    }
};

// Funciones auxiliares para archivos de configuración
const configFileService = {
    // Guardar registro de archivo enviado
    async saveConfigFile(fileData) {
        try {
            const { data, error } = await supabaseAdmin
                .from('config_files')
                .insert(fileData)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en saveConfigFile:', error);
            throw error;
        }
    },

    // Obtener historial de archivos enviados a un usuario
    async getUserConfigFiles(telegramId) {
        try {
            const { data, error } = await supabaseAdmin
                .from('config_files')
                .select('*')
                .eq('telegram_id', telegramId)
                .order('sent_at', { ascending: false });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en getUserConfigFiles:', error);
            throw error;
        }
    }
};

// Funciones auxiliares para administradores
const adminService = {
    // Verificar credenciales de administrador
    async verifyAdmin(username, password) {
        try {
            const { data, error } = await supabaseAdmin
                .from('admins')
                .select('*')
                .eq('username', username)
                .single();

            if (error) throw error;
            
            // En una implementación real, usaríamos bcrypt para comparar
            // Por ahora, comparamos directamente (en producción usa bcrypt)
            return data.password_hash === password;
        } catch (error) {
            console.error('Error en verifyAdmin:', error);
            return false;
        }
    },

    // Crear nuevo administrador
    async createAdmin(adminData) {
        try {
            const { data, error } = await supabaseAdmin
                .from('admins')
                .insert(adminData)
                .select()
                .single();

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error en createAdmin:', error);
            throw error;
        }
    }
};

// Funciones auxiliares para estadísticas
const statsService = {
    // Obtener estadísticas generales
    async getStats() {
        try {
            // Obtener estadísticas de la tabla statistics
            const { data: stats, error: statsError } = await supabaseAdmin
                .from('statistics')
                .select('*')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            if (statsError && statsError.code !== 'PGRST116') throw statsError;

            // Si no hay estadísticas, calcularlas
            if (!stats) {
                return await this.calculateStats();
            }

            return stats;
        } catch (error) {
            console.error('Error en getStats:', error);
            return await this.calculateStats();
        }
    },

    // Calcular estadísticas manualmente
    async calculateStats() {
        try {
            // Total de usuarios
            const { count: totalUsers } = await supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true });

            // Total de pagos aprobados
            const { count: totalPayments } = await supabaseAdmin
                .from('payments')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'approved');

            // Total de ingresos
            const { data: payments } = await supabaseAdmin
                .from('payments')
                .select('price')
                .eq('status', 'approved');

            const totalRevenue = payments?.reduce((sum, payment) => sum + parseFloat(payment.price || 0), 0) || 0;

            // Total de usuarios VIP
            const { count: vipUsers } = await supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .eq('vip', true);

            // Pagos aprobados hoy
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const { count: approvedToday } = await supabaseAdmin
                .from('payments')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'approved')
                .gte('created_at', today.toISOString());

            return {
                total_users: totalUsers || 0,
                total_payments: totalPayments || 0,
                total_revenue: totalRevenue || 0,
                vip_users: vipUsers || 0,
                approved_today: approvedToday || 0
            };
        } catch (error) {
            console.error('Error en calculateStats:', error);
            return {
                total_users: 0,
                total_payments: 0,
                total_revenue: 0,
                vip_users: 0,
                approved_today: 0
            };
        }
    }
};

module.exports = {
    supabase,
    supabaseAdmin,
    userService,
    paymentService,
    configFileService,
    adminService,
    statsService
};
