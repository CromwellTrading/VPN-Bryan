const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Funciones simplificadas
const db = {
  // Usuarios
  async saveUser(telegramId, userData) {
    try {
      const { data, error } = await supabase
        .from('users')
        .upsert({
          telegram_id: telegramId,
          ...userData,
          created_at: new Date().toISOString()
        }, {
          onConflict: 'telegram_id'
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error guardando usuario:', error);
      return null;
    }
  },

  async getUser(telegramId) {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    } catch (error) {
      console.error('Error obteniendo usuario:', error);
      return null;
    }
  },

  async acceptTerms(telegramId) {
    return await this.saveUser(telegramId, {
      accepted_terms: true,
      terms_date: new Date().toISOString()
    });
  },

  async setVIP(telegramId, plan, price) {
    try {
      const { data, error } = await supabase
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
      console.error('Error estableciendo VIP:', error);
      return null;
    }
  },

  async getVIPUsers() {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('vip', true)
        .order('vip_since', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error obteniendo VIP:', error);
      return [];
    }
  },

  // Pagos
  async createPayment(paymentData) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .insert(paymentData)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error creando pago:', error);
      return null;
    }
  },

  async getPendingPayments() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error obteniendo pagos pendientes:', error);
      return [];
    }
  },

  async approvePayment(paymentId) {
    try {
      // Obtener el pago primero
      const { data: payment, error: paymentError } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (paymentError) throw paymentError;

      // Actualizar estado del pago
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'approved',
          admin_notes: 'Aprobado por admin'
        })
        .eq('id', paymentId)
        .select()
        .single();

      if (error) throw error;

      // Establecer usuario como VIP
      if (payment) {
        await this.setVIP(payment.telegram_id, payment.plan, payment.price);
      }

      return data;
    } catch (error) {
      console.error('Error aprobando pago:', error);
      return null;
    }
  },

  async rejectPayment(paymentId, reason) {
    try {
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'rejected',
          admin_notes: reason || 'Rechazado por admin'
        })
        .eq('id', paymentId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error rechazando pago:', error);
      return null;
    }
  },

  // Config files
  async saveConfigFile(fileData) {
    try {
      const { data, error } = await supabase
        .from('config_files')
        .insert(fileData)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error guardando archivo:', error);
      return null;
    }
  },

  // Estadísticas
  async getStats() {
    try {
      // Total usuarios
      const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });

      // Total pagos aprobados
      const { count: totalPayments } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved');

      // Total ingresos
      const { data: payments } = await supabase
        .from('payments')
        .select('price')
        .eq('status', 'approved');

      const totalRevenue = payments?.reduce((sum, p) => sum + parseFloat(p.price || 0), 0) || 0;

      // Total VIP
      const { count: vipUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('vip', true);

      return {
        total_users: totalUsers || 0,
        total_payments: totalPayments || 0,
        total_revenue: totalRevenue,
        vip_users: vipUsers || 0
      };
    } catch (error) {
      console.error('Error obteniendo estadísticas:', error);
      return {
        total_users: 0,
        total_payments: 0,
        total_revenue: 0,
        vip_users: 0
      };
    }
  }
};

module.exports = db;
