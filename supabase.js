const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: Faltan variables de entorno SUPABASE_URL o SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const supabaseAdmin = supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : supabase;
const dbClient = supabaseAdmin;

const db = {
  // ========== STORAGE ==========
  async uploadImage(filePath, telegramId) {
    try {
      const fileBuffer = await fs.readFile(filePath);
      const fileName = `screenshot_${telegramId}_${Date.now()}.jpg`;
      const { data, error } = await supabaseAdmin.storage
        .from('payments-screenshots')
        .upload(fileName, fileBuffer, { contentType: 'image/jpeg' });
      if (error) throw error;
      const { data: { publicUrl } } = supabaseAdmin.storage.from('payments-screenshots').getPublicUrl(fileName);
      return publicUrl;
    } catch (error) {
      console.error('❌ Error uploadImage:', error);
      throw error;
    }
  },

  async uploadPlanFile(fileBuffer, plan, originalFileName) {
    try {
      const bucket = plan === 'trial' ? 'trial-files' : 'plan-files';
      const storageFileName = originalFileName;
      const { data, error } = await supabaseAdmin.storage
        .from(bucket)
        .upload(storageFileName, fileBuffer, { upsert: true });
      if (error) throw error;
      const { data: { publicUrl } } = supabaseAdmin.storage.from(bucket).getPublicUrl(storageFileName);
      return { filename: storageFileName, publicUrl, originalName: originalFileName };
    } catch (error) {
      console.error('❌ Error uploadPlanFile:', error);
      throw error;
    }
  },

  // ========== USUARIOS ==========
  async getUser(telegramId) {
    try {
      const { data, error } = await dbClient
        .from('users')
        .select('*')
        .eq('telegram_id', String(telegramId).trim())
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ getUser error:', error);
      return null;
    }
  },

  async saveUser(telegramId, userData) {
    try {
      const userId = String(telegramId).trim();
      const existing = await this.getUser(userId);
      if (existing) {
        const { data, error } = await dbClient
          .from('users')
          .update({ ...userData, updated_at: new Date().toISOString() })
          .eq('telegram_id', userId)
          .select()
          .single();
        if (error) throw error;
        return data;
      } else {
        const { data, error } = await dbClient
          .from('users')
          .insert([{ telegram_id: userId, ...userData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    } catch (error) {
      console.error('❌ saveUser error:', error);
      throw error;
    }
  },

  async updateUser(telegramId, updateData) {
    try {
      const { data, error } = await dbClient
        .from('users')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('telegram_id', String(telegramId).trim())
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ updateUser error:', error);
      throw error;
    }
  },

  async getAllUsers() {
    try {
      let all = [];
      let from = 0;
      const limit = 1000;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await dbClient
          .from('users')
          .select('*')
          .range(from, from + limit - 1);
        if (error) throw error;
        if (data && data.length) {
          all.push(...data);
          from += limit;
          if (data.length < limit) hasMore = false;
        } else {
          hasMore = false;
        }
      }
      return all;
    } catch (error) {
      console.error('❌ getAllUsers error:', error);
      return [];
    }
  },

  async getVIPUsers() {
    try {
      const { data, error } = await dbClient
        .from('users')
        .select('*')
        .eq('vip', true);
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getVIPUsers error:', error);
      return [];
    }
  },

  async makeUserVIP(telegramId, vipData) {
    try {
      const { data, error } = await dbClient
        .from('users')
        .update({ vip: true, plan: vipData.plan, plan_price: vipData.plan_price, vip_since: vipData.vip_since || new Date().toISOString() })
        .eq('telegram_id', String(telegramId).trim())
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ makeUserVIP error:', error);
      throw error;
    }
  },

  async removeVIP(telegramId) {
    try {
      const { data, error } = await dbClient
        .from('users')
        .update({ vip: false, plan: null, plan_price: null, vip_since: null })
        .eq('telegram_id', String(telegramId).trim())
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ removeVIP error:', error);
      throw error;
    }
  },

  // ========== PAGOS ==========
  async createPayment(paymentData) {
    try {
      const { data, error } = await dbClient
        .from('payments')
        .insert([{ ...paymentData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ createPayment error:', error);
      throw error;
    }
  },

  async getPayment(paymentId) {
    try {
      const { data, error } = await dbClient
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ getPayment error:', error);
      return null;
    }
  },

  async getPendingPayments() {
    try {
      const { data, error } = await dbClient
        .from('payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getPendingPayments error:', error);
      return [];
    }
  },

  async getApprovedPayments() {
    try {
      const { data, error } = await dbClient
        .from('payments')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getApprovedPayments error:', error);
      return [];
    }
  },

  async approvePayment(paymentId) {
    try {
      const { data, error } = await dbClient
        .from('payments')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', paymentId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ approvePayment error:', error);
      throw error;
    }
  },

  async rejectPayment(paymentId, reason) {
    try {
      const { data, error } = await dbClient
        .from('payments')
        .update({ status: 'rejected', rejected_reason: reason, rejected_at: new Date().toISOString() })
        .eq('id', paymentId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ rejectPayment error:', error);
      throw error;
    }
  },

  async updatePayment(paymentId, updateData) {
    try {
      const { data, error } = await dbClient
        .from('payments')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', paymentId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ updatePayment error:', error);
      throw error;
    }
  },

  // ========== REFERIDOS ==========
  async createReferral(referrerId, referredId, referredUsername, referredName) {
    try {
      const { data, error } = await dbClient
        .from('referrals')
        .insert([{
          referrer_id: String(referrerId).trim(),
          referred_id: String(referredId).trim(),
          referred_username: referredUsername,
          referred_name: referredName,
          level: 1,
          has_paid: false,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ createReferral error:', error);
      throw error;
    }
  },

  async getReferralStats(telegramId) {
    try {
      const { data: level1 } = await dbClient
        .from('referrals')
        .select('*')
        .eq('referrer_id', String(telegramId).trim())
        .eq('level', 1);
      const { data: level2 } = await dbClient
        .from('referrals')
        .select('*')
        .eq('referrer_id', String(telegramId).trim())
        .eq('level', 2);
      const level1Paid = level1?.filter(r => r.has_paid).length || 0;
      const level2Paid = level2?.filter(r => r.has_paid).length || 0;
      const discount = (level1Paid * 20) + (level2Paid * 10);
      return {
        level1: { total: level1?.length || 0, paid: level1Paid },
        level2: { total: level2?.length || 0, paid: level2Paid },
        total_referrals: (level1?.length || 0) + (level2?.length || 0),
        total_paid: level1Paid + level2Paid,
        discount_percentage: discount > 100 ? 100 : discount
      };
    } catch (error) {
      console.error('❌ getReferralStats error:', error);
      return { level1: { total: 0, paid: 0 }, level2: { total: 0, paid: 0 }, total_referrals: 0, total_paid: 0, discount_percentage: 0 };
    }
  },

  async getAllReferralsStats() {
    try {
      const { data: referrals, error } = await dbClient.from('referrals').select('*');
      if (error) throw error;
      const referrersMap = new Map();
      referrals?.forEach(r => {
        const id = r.referrer_id;
        if (!referrersMap.has(id)) referrersMap.set(id, { referrer_id: id, total: 0, paid: 0 });
        const stats = referrersMap.get(id);
        stats.total++;
        if (r.has_paid) stats.paid++;
      });
      const top_referrers = Array.from(referrersMap.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 10);
      const recent_referrals = referrals?.slice(-10).reverse() || [];
      const total_referrals = referrals?.length || 0;
      const total_paid = referrals?.filter(r => r.has_paid).length || 0;
      const level1_referrals = referrals?.filter(r => r.level === 1).length || 0;
      const level2_referrals = referrals?.filter(r => r.level === 2).length || 0;
      const paid_level1 = referrals?.filter(r => r.level === 1 && r.has_paid).length || 0;
      const paid_level2 = referrals?.filter(r => r.level === 2 && r.has_paid).length || 0;
      return {
        total_referrals,
        total_paid,
        top_referrers,
        recent_referrals,
        paid_referrals: total_paid,
        level1_referrals,
        level2_referrals,
        paid_level1,
        paid_level2
      };
    } catch (error) {
      console.error('❌ getAllReferralsStats error:', error);
      return { total_referrals: 0, total_paid: 0, top_referrers: [], recent_referrals: [], paid_referrals: 0, level1_referrals: 0, level2_referrals: 0, paid_level1: 0, paid_level2: 0 };
    }
  },

  async markReferralAsPaid(referredId) {
    try {
      const { data, error } = await dbClient
        .from('referrals')
        .update({ has_paid: true })
        .eq('referred_id', String(referredId).trim());
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ markReferralAsPaid error:', error);
      throw error;
    }
  },

  // ========== BROADCASTS ==========
  async createBroadcast(message, targetUsers, sentBy) {
    try {
      const { data, error } = await dbClient
        .from('broadcasts')
        .insert([{ message, target_users: targetUsers, sent_by: sentBy, status: 'pending', created_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ createBroadcast error:', error);
      throw error;
    }
  },

  async getBroadcasts(limit = 50) {
    try {
      const { data, error } = await dbClient
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getBroadcasts error:', error);
      return [];
    }
  },

  async getBroadcast(broadcastId) {
    try {
      const { data, error } = await dbClient
        .from('broadcasts')
        .select('*')
        .eq('id', broadcastId)
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ getBroadcast error:', error);
      return null;
    }
  },

  async updateBroadcastStatus(broadcastId, status, stats = {}) {
    try {
      const updateData = { status, updated_at: new Date().toISOString() };
      if (status === 'completed' || status === 'failed') updateData.completed_at = new Date().toISOString();
      if (stats.sent_count !== undefined) updateData.sent_count = stats.sent_count;
      if (stats.failed_count !== undefined) updateData.failed_count = stats.failed_count;
      if (stats.total_users !== undefined) updateData.total_users = stats.total_users;
      if (stats.unavailable_count !== undefined) updateData.unavailable_count = stats.unavailable_count;
      const { data, error } = await dbClient
        .from('broadcasts')
        .update(updateData)
        .eq('id', broadcastId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ updateBroadcastStatus error:', error);
      throw error;
    }
  },

  async getUsersForBroadcast(targetUsers) {
    try {
      let query = dbClient.from('users').select('telegram_id, username, first_name, vip, trial_requested, trial_received, last_activity, is_active');
      if (targetUsers === 'vip') query = query.eq('vip', true);
      else if (targetUsers === 'non_vip') query = query.eq('vip', false);
      else if (targetUsers === 'trial_pending') query = query.eq('trial_requested', true).eq('trial_received', false);
      else if (targetUsers === 'trial_received') query = query.eq('trial_received', true);
      else if (targetUsers === 'active') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        query = query.gte('last_activity', thirtyDaysAgo.toISOString());
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getUsersForBroadcast error:', error);
      return [];
    }
  },

  // ========== PRUEBAS ==========
  async getPendingTrials() {
    try {
      const { data, error } = await dbClient
        .from('users')
        .select('*')
        .eq('trial_requested', true)
        .eq('trial_received', false);
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getPendingTrials error:', error);
      return [];
    }
  },

  async markTrialAsSent(telegramId, sentBy) {
    try {
      const { data, error } = await dbClient
        .from('users')
        .update({ trial_received: true, trial_sent_at: new Date().toISOString(), trial_sent_by: sentBy })
        .eq('telegram_id', String(telegramId).trim())
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ markTrialAsSent error:', error);
      throw error;
    }
  },

  async checkTrialEligibility(telegramId) {
    try {
      const user = await this.getUser(telegramId);
      if (!user) return { eligible: true };
      if (!user.trial_requested) return { eligible: true };
      if (user.trial_requested && !user.trial_received) return { eligible: false, reason: 'Ya tiene una solicitud pendiente' };
      if (user.trial_received && user.trial_sent_at) {
        const days = Math.floor((Date.now() - new Date(user.trial_sent_at)) / (1000 * 60 * 60 * 24));
        if (days < 30) return { eligible: false, reason: `Debe esperar ${30 - days} días` };
      }
      return { eligible: true };
    } catch (error) {
      console.error('❌ checkTrialEligibility error:', error);
      return { eligible: false };
    }
  },

  // ========== ESTADÍSTICAS ==========
  async getStats() {
    try {
      const { count: totalUsers } = await dbClient.from('users').select('*', { count: 'exact', head: true });
      const { count: vipUsers } = await dbClient.from('users').select('*', { count: 'exact', head: true }).eq('vip', true);
      const { count: trialRequests } = await dbClient.from('users').select('*', { count: 'exact', head: true }).eq('trial_requested', true);
      const { count: trialReceived } = await dbClient.from('users').select('*', { count: 'exact', head: true }).eq('trial_received', true);
      const { data: payments } = await dbClient.from('payments').select('status, price, method');
      const pendingPayments = payments?.filter(p => p.status === 'pending').length || 0;
      const totalRevenue = payments?.filter(p => p.status === 'approved').reduce((s, p) => s + (parseFloat(p.price) || 0), 0) || 0;
      const usdtPayments = payments?.filter(p => p.method === 'usdt').length || 0;
      const referralsStats = await this.getAllReferralsStats();
      const { data: broadcasts } = await dbClient.from('broadcasts').select('status');
      const { data: coupons } = await dbClient.from('coupons').select('status, stock');
      const activeCoupons = coupons?.filter(c => c.status === 'active' && c.stock > 0).length || 0;
      return {
        users: { total: totalUsers || 0, vip: vipUsers || 0, trial_requests: trialRequests || 0, trial_pending: (trialRequests || 0) - (trialReceived || 0) },
        payments: { pending: pendingPayments, usdt: usdtPayments },
        revenue: { total: totalRevenue },
        referrals: { total_referrals: referralsStats.total_referrals || 0 },
        broadcasts: { total: broadcasts?.length || 0 },
        coupons: { active: activeCoupons }
      };
    } catch (error) {
      console.error('❌ getStats error:', error);
      return { users: { total: 0, vip: 0, trial_requests: 0, trial_pending: 0 }, payments: { pending: 0, usdt: 0 }, revenue: { total: 0 }, referrals: { total_referrals: 0 }, broadcasts: { total: 0 }, coupons: { active: 0 } };
    }
  },

  // ========== CUPONES ==========
  async createCoupon(couponData) {
    try {
      const { data, error } = await dbClient
        .from('coupons')
        .insert([{ ...couponData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ createCoupon error:', error);
      throw error;
    }
  },

  async getCoupons() {
    try {
      const { data, error } = await dbClient
        .from('coupons')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getCoupons error:', error);
      return [];
    }
  },

  async getCoupon(code) {
    try {
      const { data, error } = await dbClient
        .from('coupons')
        .select('*')
        .eq('code', code.toUpperCase())
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ getCoupon error:', error);
      return null;
    }
  },

  async updateCoupon(code, updateData) {
    try {
      const { data, error } = await dbClient
        .from('coupons')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('code', code.toUpperCase())
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ updateCoupon error:', error);
      throw error;
    }
  },

  async updateCouponStatus(code, status, updatedBy) {
    try {
      const { data, error } = await dbClient
        .from('coupons')
        .update({ status, updated_by: updatedBy, updated_at: new Date().toISOString() })
        .eq('code', code.toUpperCase())
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ updateCouponStatus error:', error);
      throw error;
    }
  },

  async deleteCoupon(code) {
    try {
      const { data, error } = await dbClient
        .from('coupons')
        .delete()
        .eq('code', code.toUpperCase())
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ deleteCoupon error:', error);
      throw error;
    }
  },

  async hasUserUsedCoupon(telegramId, code) {
    try {
      const { data, error } = await dbClient
        .from('coupon_usage')
        .select('id')
        .eq('telegram_id', String(telegramId).trim())
        .eq('coupon_code', code.toUpperCase())
        .maybeSingle();
      if (error) throw error;
      return !!data;
    } catch (error) {
      console.error('❌ hasUserUsedCoupon error:', error);
      return false;
    }
  },

  async applyCouponToPayment(code, telegramId, paymentId) {
    try {
      const { data, error } = await dbClient
        .from('coupon_usage')
        .insert([{ coupon_code: code.toUpperCase(), telegram_id: String(telegramId).trim(), payment_id: paymentId, used_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ applyCouponToPayment error:', error);
      throw error;
    }
  },

  // ========== ARCHIVOS ==========
  async savePlanFile(planFileData) {
    try {
      const { data, error } = await dbClient
        .from('plan_files')
        .upsert([{ ...planFileData, updated_at: new Date().toISOString() }], { onConflict: 'plan' })
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ savePlanFile error:', error);
      throw error;
    }
  },

  async getPlanFile(plan) {
    try {
      const { data, error } = await dbClient
        .from('plan_files')
        .select('*')
        .eq('plan', plan)
        .maybeSingle();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ getPlanFile error:', error);
      return null;
    }
  },

  async getAllPlanFiles() {
    try {
      const { data, error } = await dbClient
        .from('plan_files')
        .select('*');
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getAllPlanFiles error:', error);
      return [];
    }
  },

  // ========== TRIAL FILES (pool) ==========
  async getTrialFiles() {
    try {
      const { data, error } = await dbClient
        .from('trial_files')
        .select('*')
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('❌ getTrialFiles error:', error);
      return [];
    }
  },

  async saveTrialFile(fileData) {
    try {
      const { data, error } = await dbClient
        .from('trial_files')
        .insert([{ ...fileData, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ saveTrialFile error:', error);
      throw error;
    }
  },

  async updateTrialFile(id, updateData) {
    try {
      const { data, error } = await dbClient
        .from('trial_files')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('❌ updateTrialFile error:', error);
      throw error;
    }
  },

  async deleteTrialFile(id) {
    try {
      const { error } = await dbClient
        .from('trial_files')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return true;
    } catch (error) {
      console.error('❌ deleteTrialFile error:', error);
      return false;
    }
  }
};

module.exports = db; 
