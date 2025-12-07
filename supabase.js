const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY/SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const db = {
  // ========== STORAGE (IMÁGENES) ==========
  async uploadImage(filePath, telegramId) {
    try {
      console.log(`📤 Subiendo imagen para usuario ${telegramId}: ${filePath}`);
      
      // Leer el archivo como buffer
      const fileBuffer = await fs.readFile(filePath);
      const fileName = `screenshot_${telegramId}_${Date.now()}.jpg`;
      
      console.log(`📁 Nombre del archivo en storage: ${fileName}`);
      
      // Subir a Supabase Storage
      const { data, error } = await supabase.storage
        .from('payments-screenshots')
        .upload(fileName, fileBuffer, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('❌ Error subiendo imagen a Supabase Storage:', error);
        throw error;
      }

      console.log('✅ Imagen subida a storage. Obtener URL pública...');

      // Obtener URL pública
      const { data: { publicUrl } } = supabase.storage
        .from('payments-screenshots')
        .getPublicUrl(fileName);

      console.log(`✅ URL pública obtenida: ${publicUrl}`);
      return publicUrl;

    } catch (error) {
      console.error('❌ Error en uploadImage:', error);
      throw error;
    }
  },

  // ========== USUARIOS ==========
  async getUser(telegramId) {
    try {
      console.log(`🔍 Buscando usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Usuario ${telegramId} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo usuario:', error.message);
        return null;
      }
      
      console.log(`✅ Usuario encontrado: ${data.first_name || data.username || telegramId}`);
      return data;
    } catch (error) {
      console.error('❌ Error en getUser:', error);
      return null;
    }
  },

  async saveUser(telegramId, userData) {
    try {
      console.log(`💾 Guardando usuario ${telegramId}...`);
      
      // Verificar si el usuario ya existe
      const existingUser = await this.getUser(telegramId);
      
      if (existingUser) {
        // Actualizar usuario existente
        console.log(`✏️ Actualizando usuario existente ${telegramId}`);
        
        const updateData = {
          ...userData,
          updated_at: new Date().toISOString()
        };
        
        // Si se envía trial_requested, actualizar también trial_requested_at
        if (userData.trial_requested && !existingUser.trial_requested) {
          updateData.trial_requested_at = new Date().toISOString();
        }
        
        // Si se envía trial_received, actualizar también trial_sent_at
        if (userData.trial_received && !existingUser.trial_received) {
          updateData.trial_sent_at = new Date().toISOString();
        }
        
        // Si se envía trial_plan_type, actualizarlo
        if (userData.trial_plan_type) {
          updateData.trial_plan_type = userData.trial_plan_type;
        }
        
        const { data, error } = await supabase
          .from('users')
          .update(updateData)
          .eq('telegram_id', telegramId)
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error actualizando usuario:', error);
          throw error;
        }
        
        console.log(`✅ Usuario actualizado: ${data.first_name || data.username || telegramId}`);
        return data;
      } else {
        // Crear nuevo usuario
        console.log(`🆕 Creando nuevo usuario ${telegramId}`);
        
        const insertData = {
          telegram_id: telegramId,
          ...userData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        
        // Si es solicitud de prueba, agregar fecha
        if (userData.trial_requested) {
          insertData.trial_requested_at = new Date().toISOString();
          insertData.trial_plan_type = userData.trial_plan_type || '1h';
        }
        
        const { data, error } = await supabase
          .from('users')
          .insert([insertData])
          .select()
          .single();
        
        if (error) {
          console.error('❌ Error creando usuario:', error);
          throw error;
        }
        
        console.log(`✅ Usuario creado: ${data.first_name || data.username || telegramId}`);
        return data;
      }
    } catch (error) {
      console.error('❌ Error guardando usuario:', error);
      throw error;
    }
  },

  async updateUser(telegramId, updateData) {
    try {
      console.log(`✏️ Actualizando usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando usuario:', error);
        throw error;
      }
      
      console.log(`✅ Usuario ${telegramId} actualizado`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando usuario:', error);
      throw error;
    }
  },

  async acceptTerms(telegramId) {
    console.log(`✅ Aceptando términos para usuario ${telegramId}`);
    return await this.saveUser(telegramId, {
      accepted_terms: true,
      terms_date: new Date().toISOString()
    });
  },

  async makeUserVIP(telegramId, vipData = {}) {
    try {
      console.log(`👑 Haciendo usuario ${telegramId} VIP...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          vip: true,
          plan: vipData.plan || 'vip',
          plan_price: vipData.plan_price || 0,
          vip_since: vipData.vip_since || new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error haciendo usuario VIP:', error);
        throw error;
      }
      
      console.log(`✅ Usuario ${telegramId} marcado como VIP`);
      return data;
    } catch (error) {
      console.error('❌ Error haciendo usuario VIP:', error);
      throw error;
    }
  },

  async removeVIP(telegramId) {
    try {
      console.log(`👑 Removiendo VIP de usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          vip: false,
          plan: null,
          plan_price: null,
          vip_since: null,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error removiendo VIP:', error);
        throw error;
      }
      
      console.log(`✅ VIP removido de usuario ${telegramId}`);
      return data;
    } catch (error) {
      console.error('❌ Error removiendo VIP:', error);
      throw error;
    }
  },

  async getAllUsers() {
    try {
      console.log('👥 Obteniendo todos los usuarios...');
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo todos los usuarios:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usuarios encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo todos los usuarios:', error);
      return [];
    }
  },

  async getVIPUsers() {
    try {
      console.log('👑 Obteniendo usuarios VIP...');
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('vip', true)
        .order('vip_since', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo usuarios VIP:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usuarios VIP encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo usuarios VIP:', error);
      return [];
    }
  },

  // ========== PAGOS ==========
  async createPayment(paymentData) {
    try {
      console.log('💰 Creando pago en base de datos...', {
        telegram_id: paymentData.telegram_id,
        plan: paymentData.plan,
        price: paymentData.price,
        status: paymentData.status
      });
      
      const { data, error } = await supabase
        .from('payments')
        .insert([{
          ...paymentData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error creando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago creado con ID: ${data.id}`);
      return data;
    } catch (error) {
      console.error('❌ Error creando pago:', error);
      throw error;
    }
  },

  async getPayment(paymentId) {
    try {
      console.log(`🔍 Buscando pago ${paymentId}...`);
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();
      
      if (error && error.code === 'PGRST116') {
        console.log(`📭 Pago ${paymentId} no encontrado`);
        return null;
      }
      
      if (error) {
        console.error('❌ Error obteniendo pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} encontrado`);
      return data;
    } catch (error) {
      console.error('❌ Error obteniendo pago:', error);
      return null;
    }
  },

  async getPendingPayments() {
    try {
      console.log('🔍 Buscando pagos pendientes...');
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos pendientes:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos pendientes encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos pendientes:', error);
      return [];
    }
  },

  async getApprovedPayments() {
    try {
      console.log('🔍 Buscando pagos aprobados...');
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos aprobados:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos aprobados encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos aprobados:', error);
      return [];
    }
  },

  async approvePayment(paymentId) {
    try {
      console.log(`✅ Aprobando pago ${paymentId}...`);
      
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error aprobando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} aprobado`);
      return data;
    } catch (error) {
      console.error('❌ Error aprobando pago:', error);
      throw error;
    }
  },

  async rejectPayment(paymentId, reason) {
    try {
      console.log(`❌ Rechazando pago ${paymentId} con motivo: ${reason}`);
      
      const { data, error } = await supabase
        .from('payments')
        .update({
          status: 'rejected',
          rejected_reason: reason,
          rejected_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error rechazando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} rechazado`);
      return data;
    } catch (error) {
      console.error('❌ Error rechazando pago:', error);
      throw error;
    }
  },

  async updatePayment(paymentId, updateData) {
    try {
      console.log(`✏️ Actualizando pago ${paymentId}...`);
      
      const { data, error } = await supabase
        .from('payments')
        .update({
          ...updateData,
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando pago:', error);
        throw error;
      }
      
      console.log(`✅ Pago ${paymentId} actualizado`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando pago:', error);
      throw error;
    }
  },

  async getUserPayments(telegramId) {
    try {
      console.log(`📊 Obteniendo pagos del usuario ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('telegram_id', telegramId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo pagos del usuario:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pagos encontrados para usuario ${telegramId}`);
      return data || [];
    } catch (error) {
      console.error('❌ Error obteniendo pagos del usuario:', error);
      return [];
    }
  },

  async saveConfigFile(configData) {
    try {
      console.log(`💾 Guardando registro de archivo de configuración...`);
      
      const { data, error } = await supabase
        .from('config_files')
        .insert([{
          ...configData,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error guardando configuración:', error);
        throw error;
      }
      
      console.log(`✅ Configuración guardada con ID: ${data.id}`);
      return data;
    } catch (error) {
      console.error('❌ Error guardando configuración:', error);
      throw error;
    }
  },

  async getStats() {
    try {
      console.log('📊 Obteniendo estadísticas...');
      
      // Obtener estadísticas de usuarios
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('vip, created_at, trial_requested, trial_received');
      
      if (usersError) {
        console.error('❌ Error obteniendo usuarios para estadísticas:', usersError);
        throw usersError;
      }
      
      const totalUsers = usersData?.length || 0;
      const vipUsers = usersData?.filter(u => u.vip)?.length || 0;
      const trialRequests = usersData?.filter(u => u.trial_requested)?.length || 0;
      const trialReceived = usersData?.filter(u => u.trial_received)?.length || 0;
      
      // Obtener estadísticas de pagos
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('status, price, plan');
      
      if (paymentsError) {
        console.error('❌ Error obteniendo pagos para estadísticas:', paymentsError);
        throw paymentsError;
      }
      
      const totalPayments = paymentsData?.length || 0;
      const pendingPayments = paymentsData?.filter(p => p.status === 'pending')?.length || 0;
      const approvedPayments = paymentsData?.filter(p => p.status === 'approved')?.length || 0;
      const rejectedPayments = paymentsData?.filter(p => p.status === 'rejected')?.length || 0;
      
      // Calcular ingresos totales
      const totalRevenue = paymentsData
        ?.filter(p => p.status === 'approved' && p.price)
        ?.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0) || 0;
      
      // Calcular ingresos por plan
      const revenueByPlan = {};
      paymentsData?.forEach(p => {
        if (p.status === 'approved' && p.price && p.plan) {
          revenueByPlan[p.plan] = (revenueByPlan[p.plan] || 0) + (parseFloat(p.price) || 0);
        }
      });
      
      // Calcular usuarios nuevos hoy
      const today = new Date().toISOString().split('T')[0];
      const newUsersToday = usersData?.filter(u => 
        u.created_at && u.created_at.startsWith(today)
      )?.length || 0;
      
      // Obtener pagos de hoy
      const { data: todayPayments, error: todayPaymentsError } = await supabase
        .from('payments')
        .select('status, price, created_at')
        .gte('created_at', today);
      
      let revenueToday = 0;
      let paymentsToday = 0;
      
      if (!todayPaymentsError && todayPayments) {
        revenueToday = todayPayments
          .filter(p => p.status === 'approved' && p.price)
          .reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0);
        
        paymentsToday = todayPayments.length;
      }
      
      // Obtener estadísticas de trial
      const trialStats = await this.getTrialStats();
      
      return {
        users: {
          total: totalUsers,
          vip: vipUsers,
          regular: totalUsers - vipUsers,
          new_today: newUsersToday,
          trial_requests: trialStats.total_requests,
          trial_received: trialStats.completed,
          trial_pending: trialStats.pending
        },
        payments: {
          total: totalPayments,
          pending: pendingPayments,
          approved: approvedPayments,
          rejected: rejectedPayments,
          today: paymentsToday
        },
        revenue: {
          total: totalRevenue,
          average: approvedPayments > 0 ? totalRevenue / approvedPayments : 0,
          today: revenueToday,
          by_plan: revenueByPlan
        },
        charts: {
          daily_payments: await this.getDailyPaymentsChart(),
          plan_distribution: await this.getPlanDistribution()
        }
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      return {
        users: { 
          total: 0, 
          vip: 0, 
          regular: 0, 
          new_today: 0,
          trial_requests: 0,
          trial_received: 0,
          trial_pending: 0
        },
        payments: { 
          total: 0, 
          pending: 0, 
          approved: 0, 
          rejected: 0, 
          today: 0 
        },
        revenue: { 
          total: 0, 
          average: 0, 
          today: 0,
          by_plan: {}
        },
        charts: {
          daily_payments: [],
          plan_distribution: []
        }
      };
    }
  },

  async getDailyPaymentsChart() {
    try {
      console.log('📈 Obteniendo datos para gráfico de pagos diarios...');
      
      // Obtener pagos de los últimos 7 días
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const { data, error } = await supabase
        .from('payments')
        .select('created_at, status, price')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: true });
      
      if (error) {
        console.error('❌ Error obteniendo datos para gráfico:', error);
        return [];
      }
      
      // Agrupar por día
      const dailyData = {};
      
      data?.forEach(payment => {
        const date = payment.created_at.split('T')[0];
        if (!dailyData[date]) {
          dailyData[date] = {
            date,
            total: 0,
            approved: 0,
            pending: 0,
            revenue: 0
          };
        }
        
        dailyData[date].total += 1;
        
        if (payment.status === 'approved') {
          dailyData[date].approved += 1;
          dailyData[date].revenue += parseFloat(payment.price) || 0;
        } else if (payment.status === 'pending') {
          dailyData[date].pending += 1;
        }
      });
      
      // Convertir a array y ordenar por fecha
      const result = Object.values(dailyData).sort((a, b) => a.date.localeCompare(b.date));
      
      console.log(`✅ Datos para gráfico obtenidos: ${result.length} días`);
      return result;
    } catch (error) {
      console.error('❌ Error en getDailyPaymentsChart:', error);
      return [];
    }
  },

  async getPlanDistribution() {
    try {
      console.log('📊 Obteniendo distribución de planes...');
      
      const { data, error } = await supabase
        .from('payments')
        .select('plan, status')
        .eq('status', 'approved');
      
      if (error) {
        console.error('❌ Error obteniendo distribución de planes:', error);
        return [];
      }
      
      const planCounts = {
        'basico': 0,
        'premium': 0,
        'vip': 0
      };
      
      data?.forEach(payment => {
        if (planCounts[payment.plan] !== undefined) {
          planCounts[payment.plan] += 1;
        }
      });
      
      // Convertir a array para gráfico
      const result = Object.entries(planCounts).map(([plan, count]) => ({
        plan: plan === 'basico' ? 'Básico' : plan === 'premium' ? 'Premium' : 'VIP',
        count,
        percentage: data.length > 0 ? (count / data.length * 100).toFixed(1) : 0
      }));
      
      console.log('✅ Distribución de planes obtenida');
      return result;
    } catch (error) {
      console.error('❌ Error en getPlanDistribution:', error);
      return [];
    }
  },

  async searchUsers(searchTerm) {
    try {
      console.log(`🔍 Buscando usuarios con término: ${searchTerm}`);
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .or(`telegram_id.ilike.%${searchTerm}%,username.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%`)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) {
        console.error('❌ Error buscando usuarios:', error);
        return [];
      }
      
      console.log(`✅ ${data?.length || 0} usuarios encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en searchUsers:', error);
      return [];
    }
  },

  async searchPayments(searchTerm) {
    try {
      console.log(`🔍 Buscando pagos con término: ${searchTerm}`);
      
      // Buscar por ID de pago o ID de usuario
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .or(`id.eq.${searchTerm},telegram_id.ilike.%${searchTerm}%`)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) {
        console.error('❌ Error buscando pagos:', error);
        return [];
      }
      
      console.log(`✅ ${data?.length || 0} pagos encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en searchPayments:', error);
      return [];
    }
  },

  async getRecentActivity(limit = 20) {
    try {
      console.log(`📅 Obteniendo actividad reciente (${limit} items)...`);
      
      // Obtener pagos recientes
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (paymentsError) {
        console.error('❌ Error obteniendo pagos recientes:', paymentsError);
        return [];
      }
      
      // Obtener usuarios recientes
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      
      if (usersError) {
        console.error('❌ Error obteniendo usuarios recientes:', usersError);
        return [];
      }
      
      // Combinar y ordenar por fecha
      const activity = [
        ...payments.map(p => ({
          type: 'payment',
          id: p.id,
          telegram_id: p.telegram_id,
          status: p.status,
          plan: p.plan,
          price: p.price,
          created_at: p.created_at,
          updated_at: p.updated_at
        })),
        ...users.map(u => ({
          type: 'user',
          id: u.id,
          telegram_id: u.telegram_id,
          username: u.username,
          first_name: u.first_name,
          vip: u.vip,
          trial_requested: u.trial_requested,
          trial_received: u.trial_received,
          created_at: u.created_at,
          updated_at: u.updated_at
        }))
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
       .slice(0, limit);
      
      console.log(`✅ ${activity.length} actividades recientes obtenidas`);
      return activity;
    } catch (error) {
      console.error('❌ Error en getRecentActivity:', error);
      return [];
    }
  },

  async getPaymentStatsByUser(telegramId) {
    try {
      console.log(`📊 Obteniendo estadísticas de pagos para usuario ${telegramId}`);
      
      const { data, error } = await supabase
        .from('payments')
        .select('status, plan, price, created_at')
        .eq('telegram_id', telegramId);
      
      if (error) {
        console.error('❌ Error obteniendo estadísticas de usuario:', error);
        return null;
      }
      
      const totalPayments = data?.length || 0;
      const approvedPayments = data?.filter(p => p.status === 'approved')?.length || 0;
      const pendingPayments = data?.filter(p => p.status === 'pending')?.length || 0;
      const rejectedPayments = data?.filter(p => p.status === 'rejected')?.length || 0;
      
      const totalSpent = data
        ?.filter(p => p.status === 'approved' && p.price)
        ?.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0) || 0;
      
      const lastPayment = data?.length > 0 
        ? data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        : null;
      
      const planDistribution = {};
      data?.forEach(payment => {
        if (payment.plan) {
          planDistribution[payment.plan] = (planDistribution[payment.plan] || 0) + 1;
        }
      });
      
      return {
        total_payments: totalPayments,
        approved_payments: approvedPayments,
        pending_payments: pendingPayments,
        rejected_payments: rejectedPayments,
        total_spent: totalSpent,
        average_payment: approvedPayments > 0 ? totalSpent / approvedPayments : 0,
        last_payment: lastPayment,
        plan_distribution: planDistribution,
        payment_history: data || []
      };
    } catch (error) {
      console.error('❌ Error en getPaymentStatsByUser:', error);
      return null;
    }
  },

  async getAdminStats() {
    try {
      console.log('📈 Obteniendo estadísticas para administrador...');
      
      const [
        usersStats,
        paymentsStats,
        revenueStats,
        dailyChart,
        planDistribution,
        recentActivity
      ] = await Promise.all([
        this.getStats(),
        this.getPaymentStats(),
        this.getRevenueStats(),
        this.getDailyPaymentsChart(),
        this.getPlanDistribution(),
        this.getRecentActivity(10)
      ]);
      
      return {
        ...usersStats,
        payments: paymentsStats,
        revenue: revenueStats,
        charts: {
          daily_payments: dailyChart,
          plan_distribution: planDistribution
        },
        recent_activity: recentActivity
      };
    } catch (error) {
      console.error('❌ Error en getAdminStats:', error);
      return {
        users: { 
          total: 0, 
          vip: 0, 
          regular: 0, 
          new_today: 0,
          trial_requests: 0,
          trial_received: 0,
          trial_pending: 0
        },
        payments: { 
          total: 0, 
          pending: 0, 
          approved: 0, 
          rejected: 0, 
          today: 0 
        },
        revenue: { 
          total: 0, 
          average: 0, 
          today: 0,
          by_plan: {}
        },
        charts: {
          daily_payments: [],
          plan_distribution: []
        },
        recent_activity: []
      };
    }
  },

  async getPaymentStats() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('status, created_at');
      
      if (error) {
        throw error;
      }
      
      const today = new Date().toISOString().split('T')[0];
      const todayPayments = data?.filter(p => p.created_at?.startsWith(today))?.length || 0;
      
      return {
        total: data?.length || 0,
        pending: data?.filter(p => p.status === 'pending')?.length || 0,
        approved: data?.filter(p => p.status === 'approved')?.length || 0,
        rejected: data?.filter(p => p.status === 'rejected')?.length || 0,
        today: todayPayments
      };
    } catch (error) {
      console.error('❌ Error en getPaymentStats:', error);
      return {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        today: 0
      };
    }
  },

  async getRevenueStats() {
    try {
      const { data, error } = await supabase
        .from('payments')
        .select('price, status, created_at, plan');
      
      if (error) {
        throw error;
      }
      
      const approvedPayments = data?.filter(p => p.status === 'approved' && p.price) || [];
      const totalRevenue = approvedPayments.reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0);
      
      const today = new Date().toISOString().split('T')[0];
      const todayRevenue = approvedPayments
        .filter(p => p.created_at?.startsWith(today))
        .reduce((sum, p) => sum + (parseFloat(p.price) || 0), 0);
      
      // Calcular ingresos por plan
      const revenueByPlan = {};
      approvedPayments.forEach(p => {
        if (p.plan) {
          revenueByPlan[p.plan] = (revenueByPlan[p.plan] || 0) + (parseFloat(p.price) || 0);
        }
      });
      
      return {
        total: totalRevenue,
        average: approvedPayments.length > 0 ? totalRevenue / approvedPayments.length : 0,
        today: todayRevenue,
        by_plan: revenueByPlan
      };
    } catch (error) {
      console.error('❌ Error en getRevenueStats:', error);
      return {
        total: 0,
        average: 0,
        today: 0,
        by_plan: {}
      };
    }
  },

  // ========== FUNCIONES DE PRUEBA GRATUITA ==========
  async getTrialStats() {
    try {
      console.log('🎯 Obteniendo estadísticas de pruebas...');
      
      const { data, error } = await supabase
        .from('users')
        .select('trial_requested, trial_received, trial_requested_at, trial_sent_at, trial_plan_type')
        .eq('trial_requested', true);
      
      if (error) {
        console.error('❌ Error obteniendo estadísticas de prueba:', error);
        throw error;
      }
      
      const totalRequests = data?.length || 0;
      const completedTrials = data?.filter(u => u.trial_received)?.length || 0;
      const pendingTrials = totalRequests - completedTrials;
      
      // Calcular solicitudes de hoy
      const today = new Date().toISOString().split('T')[0];
      const todayRequests = data?.filter(u => 
        u.trial_requested_at && u.trial_requested_at.startsWith(today)
      )?.length || 0;
      
      // Calcular por tipo de prueba
      const trialByType = {
        '1h': data?.filter(u => u.trial_plan_type === '1h')?.length || 0,
        '24h': data?.filter(u => u.trial_plan_type === '24h')?.length || 0
      };
      
      return {
        total_requests: totalRequests,
        completed: completedTrials,
        pending: pendingTrials,
        today_requests: todayRequests,
        by_type: trialByType
      };
    } catch (error) {
      console.error('❌ Error en getTrialStats:', error);
      return {
        total_requests: 0,
        completed: 0,
        pending: 0,
        today_requests: 0,
        by_type: {}
      };
    }
  },

  async getPendingTrials() {
    try {
      console.log('⏳ Obteniendo pruebas pendientes...');
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('trial_requested', true)
        .eq('trial_received', false)
        .order('trial_requested_at', { ascending: true });
      
      if (error) {
        console.error('❌ Error obteniendo pruebas pendientes:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} pruebas pendientes encontradas`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en getPendingTrials:', error);
      return [];
    }
  },

  async markTrialAsSent(telegramId, sentBy) {
    try {
      console.log(`✅ Marcando prueba como enviada para ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          trial_received: true,
          trial_sent_at: new Date().toISOString(),
          trial_sent_by: sentBy,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error marcando prueba como enviada:', error);
        throw error;
      }
      
      console.log(`✅ Prueba marcada como enviada para ${telegramId}`);
      return data;
    } catch (error) {
      console.error('❌ Error en markTrialAsSent:', error);
      throw error;
    }
  },

  async checkTrialEligibility(telegramId) {
    try {
      console.log(`🔍 Verificando elegibilidad para prueba de ${telegramId}...`);
      
      const user = await this.getUser(telegramId);
      
      if (!user) {
        return {
          eligible: true,
          reason: 'Nuevo usuario'
        };
      }
      
      // Verificar si ya solicitó prueba
      if (!user.trial_requested) {
        return {
          eligible: true,
          reason: 'Primera solicitud'
        };
      }
      
      // Verificar si ya recibió prueba
      if (user.trial_requested && !user.trial_received) {
        return {
          eligible: false,
          reason: 'Ya tiene una solicitud pendiente'
        };
      }
      
      // Verificar si recibió prueba hace menos de 30 días
      if (user.trial_received && user.trial_sent_at) {
        const lastTrialDate = new Date(user.trial_sent_at);
        const now = new Date();
        const daysSinceLastTrial = Math.floor((now - lastTrialDate) / (1000 * 60 * 60 * 24));
        
        if (daysSinceLastTrial < 30) {
          return {
            eligible: false,
            reason: `Debe esperar ${30 - daysSinceLastTrial} días para solicitar otra prueba`,
            days_remaining: 30 - daysSinceLastTrial
          };
        }
      }
      
      return {
        eligible: true,
        reason: 'Puede solicitar nueva prueba'
      };
    } catch (error) {
      console.error('❌ Error en checkTrialEligibility:', error);
      return {
        eligible: false,
        reason: 'Error verificando elegibilidad'
      };
    }
  },

  async getUsersWithTrials() {
    try {
      console.log('👥 Obteniendo usuarios con solicitudes de prueba...');
      
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('trial_requested', true)
        .order('trial_requested_at', { ascending: false });
      
      if (error) {
        console.error('❌ Error obteniendo usuarios con pruebas:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} usuarios con pruebas encontrados`);
      return data || [];
    } catch (error) {
      console.error('❌ Error en getUsersWithTrials:', error);
      return [];
    }
  },

  async updateUserTrial(telegramId, trialData) {
    try {
      console.log(`✏️ Actualizando datos de prueba para ${telegramId}...`);
      
      const { data, error } = await supabase
        .from('users')
        .update({
          ...trialData,
          updated_at: new Date().toISOString()
        })
        .eq('telegram_id', telegramId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Error actualizando datos de prueba:', error);
        throw error;
      }
      
      console.log(`✅ Datos de prueba actualizados para ${telegramId}`);
      return data;
    } catch (error) {
      console.error('❌ Error actualizando datos de prueba:', error);
      throw error;
    }
  }
};

module.exports = db;
