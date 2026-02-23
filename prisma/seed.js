const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.upsert({
        where: { username: 'admin' },
        update: {},
        create: {
            username: 'admin',
            password: adminPassword,
            role: 'ADMIN'
        }
    });
    console.log(`✅ Admin user created: ${admin.username} (password: admin123)`);

    // Create sample users
    const user1Password = await bcrypt.hash('user123', 10);
    const user1 = await prisma.user.upsert({
        where: { username: 'jsmith' },
        update: {},
        create: {
            username: 'jsmith',
            password: user1Password,
            role: 'USER'
        }
    });
    console.log(`✅ User created: ${user1.username} (password: user123)`);

    const user2Password = await bcrypt.hash('user123', 10);
    const user2 = await prisma.user.upsert({
        where: { username: 'mjohnson' },
        update: {},
        create: {
            username: 'mjohnson',
            password: user2Password,
            role: 'USER'
        }
    });
    console.log(`✅ User created: ${user2.username} (password: user123)`);

    // Create sample schedules for jsmith
    const schedules = [
        { userId: user1.id, projectTitle: 'PSA - Platform Support & Administration', isAssigned: true },
        { userId: user1.id, projectTitle: 'ERP - SAP S/4HANA Migration', isAssigned: true },
        { userId: user1.id, projectTitle: 'CRM - Salesforce Integration', isAssigned: true },
        { userId: user1.id, projectTitle: 'BI - Power BI Dashboard Development', isAssigned: true },
        { userId: user2.id, projectTitle: 'INFRA - Cloud Infrastructure Setup', isAssigned: true },
        { userId: user2.id, projectTitle: 'SEC - Cybersecurity Audit', isAssigned: true }
    ];

    for (const s of schedules) {
        await prisma.schedule.create({ data: s });
    }
    console.log(`✅ ${schedules.length} schedules created`);

    console.log('\n🎉 Seeding complete!');
    console.log('\n📋 Login credentials:');
    console.log('   Admin: admin / admin123');
    console.log('   User:  jsmith / user123');
    console.log('   User:  mjohnson / user123');
    console.log('\n🔑 External API Key: psa-external-api-key-uipath-snowflake');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
