const axios = require('axios');

async function testAgenciesAPI() {
  try {
    // Login as admin
    console.log('=== Step 1: Logging in as admin ===');
    const loginRes = await axios.post('http://localhost:3000/api/admin/auth/login', {
      email: 'admin@yourapp.com',
      password: 'AdminPassword123',
    });

    const token = loginRes.data.accessToken;
    console.log('✓ Login successful');
    console.log('  Token:', token.substring(0, 30) + '...');
    console.log('  Admin:', loginRes.data.admin.name, `(${loginRes.data.admin.role})`);

    // Get agencies list
    console.log('\n=== Step 2: Fetching agencies list ===');
    const agenciesRes = await axios.get('http://localhost:3000/api/admin/agencies', {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    console.log('✓ API call successful');
    console.log(`  Found ${agenciesRes.data.data.length} agencies`);
    console.log('\n=== Agency Data ===');
    
    // Display first agency with key fields
    if (agenciesRes.data.data.length > 0) {
      const first = agenciesRes.data.data[0];
      console.log(`\n📊 Agency: ${first.name}`);
      console.log(`   Owner: ${first.ownerName}`);
      console.log(`   Status: ${first.status}`);
      console.log(`   Hosts Count: ${first.hostsCount} ← REAL DATA!`);
      console.log(`   Level: ${first.level}`);
      console.log(`   Commission Rate: ${first.commissionRate}`);
      console.log(`   Total Earnings: $${first.totalEarnings}`);
    }

    // Show summary
    console.log('\n=== Summary ===');
    console.log(JSON.stringify(agenciesRes.data, null, 2));

  } catch (err) {
    console.error('\n❌ Error:', err.response?.data || err.message);
    if (err.response?.status) {
      console.error('   Status:', err.response.status);
    }
  }
}

testAgenciesAPI();
