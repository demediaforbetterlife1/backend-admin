const axios = require('axios');

const API_URL = 'http://127.0.0.1:3000';

async function testVipPlansAPI() {
  try {
    console.log('=== TESTING VIP PLANS API ===');
    console.log('URL:', `${API_URL}/api/vip/plans`);
    console.log('');
    
    const response = await axios.get(`${API_URL}/api/vip/plans`);
    
    console.log('STATUS:', response.status);
    console.log('');
    console.log('RESPONSE BODY:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');
    
    const plans = response.data?.data || response.data;
    console.log('PLANS COUNT:', Array.isArray(plans) ? plans.length : 'NOT AN ARRAY');
    
    if (Array.isArray(plans) && plans.length > 0) {
      console.log('');
      console.log('✅ API RETURNS PLANS:');
      plans.forEach((plan, index) => {
        console.log(`${index + 1}. ${plan.tier || plan.type} - ${plan.nameAr || plan.name}`);
      });
    } else {
      console.log('❌ API RETURNS EMPTY OR INVALID DATA');
    }
    
  } catch (error) {
    console.error('❌ API ERROR:', error.message);
    if (error.response) {
      console.error('STATUS:', error.response.status);
      console.error('DATA:', error.response.data);
    }
  }
}

testVipPlansAPI();
