/**
 * Seed Developer Productivity Snapshots
 * 
 * Generates 6 months of historical DDPS data for all developers
 * with realistic random variations
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

// Database connection
async function getConnection() {
    const url = new URL(process.env.DATABASE_URL || 'mysql://root:l3v75th5n@localhost:3306/irongate_qa');
    return mysql.createConnection({
        host: url.hostname,
        port: parseInt(url.port || '3306'),
        user: url.username,
        password: url.password,
        database: url.pathname.slice(1),
    });
}

async function query(conn: mysql.Connection, sql: string, params?: any[]) {
    const [rows] = await conn.execute(sql, params);
    return rows as any[];
}

// Calculate DDPS from raw metrics
function calculateDDPS(
    focusTime: number,
    prTime: number,
    reviewTime: number,
    meetingTime: number,
    contextSwitches: number
): { ddps: number; norms: { ft: number; prt: number; rt: number; mt: number; cs: number } } {
    // Normalize to 8-hour workday
    const ft_n = focusTime / 8;
    const prt_n = prTime / 8;
    const rt_n = reviewTime / 8;
    const mt_n = meetingTime / 8;
    const cs_n = Math.min(contextSwitches / 5, 1);

    // DDPS formula
    const numerator = 1.0 * ft_n + 0.8 * prt_n;
    const denominator = 1 + 0.5 * rt_n + 0.7 * mt_n + 1.2 * cs_n;
    const ddps = numerator / denominator;

    return {
        ddps: Math.round(ddps * 10000) / 10000,
        norms: {
            ft: Math.round(ft_n * 10000) / 10000,
            prt: Math.round(prt_n * 10000) / 10000,
            rt: Math.round(rt_n * 10000) / 10000,
            mt: Math.round(mt_n * 10000) / 10000,
            cs: Math.round(cs_n * 10000) / 10000
        }
    };
}

// Generate random value with variation around base
function randomWithVariation(base: number, variation: number, min: number, max: number): number {
    const value = base + (Math.random() - 0.5) * 2 * variation;
    return Math.round(Math.min(Math.max(value, min), max) * 100) / 100;
}

// Generate metrics for a developer with some trends
function generateDailyMetrics(dayOffset: number, developerSeed: number) {
    // Base values depend on developer seed for consistency
    const baseFocus = 3 + (developerSeed % 4); // 3-6 hours base
    const basePR = 1 + (developerSeed % 3); // 1-3 hours base
    const baseReview = 0.5 + (developerSeed % 2) * 0.5; // 0.5-1.5 hours base
    const baseMeeting = 1 + (developerSeed % 3); // 1-3 hours base
    const baseCS = 2 + (developerSeed % 5); // 2-6 switches base

    // Add daily variation
    const dayVariation = Math.sin(dayOffset / 7) * 0.2; // Weekly pattern
    const randomVariation = Math.random() * 0.3;

    return {
        focus_time_hours: randomWithVariation(baseFocus + dayVariation, 1.5, 0.5, 7),
        pr_merge_time_avg: randomWithVariation(basePR, 1, 0.2, 6),
        code_review_time_avg: randomWithVariation(baseReview, 0.5, 0.1, 3),
        meeting_time_hours: randomWithVariation(baseMeeting + randomVariation, 1, 0.5, 5),
        context_switches_per_day: Math.round(randomWithVariation(baseCS, 3, 1, 15))
    };
}

export async function seedProductivitySnapshots() {
    console.log('Seeding developer productivity snapshots...');
    const conn = await getConnection();

    try {
        // Get all developers (engineers and team leads)
        const developers = await query(conn, `
          SELECT id FROM users 
          WHERE role IN ('engineer', 'qa_engineer', 'team_lead')
          AND is_active = 1
        `);

        if (!developers.length) {
            console.log('No developers found to seed');
            await conn.end();
            return;
        }

        console.log(`Found ${developers.length} developers to seed`);

        // Clear existing snapshots
        await query(conn, 'DELETE FROM developer_productivity_snapshots');
        console.log('Cleared existing snapshots');

        // Generate 6 months of data (180 days)
        const today = new Date();
        const daysToGenerate = 180;

        let insertCount = 0;
        const batchSize = 500;
        let batch: string[] = [];

        for (let dayOffset = 0; dayOffset < daysToGenerate; dayOffset++) {
            const snapshotDate = new Date(today);
            snapshotDate.setDate(today.getDate() - dayOffset);
            const dateStr = snapshotDate.toISOString().split('T')[0];

            // Skip weekends (optional - for more realistic data)
            const dayOfWeek = snapshotDate.getDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) continue;

            for (let i = 0; i < developers.length; i++) {
                const dev = developers[i];
                const developerSeed = dev.id.charCodeAt(dev.id.length - 1) || i;

                const metrics = generateDailyMetrics(dayOffset, developerSeed);
                const { ddps, norms } = calculateDDPS(
                    metrics.focus_time_hours,
                    metrics.pr_merge_time_avg,
                    metrics.code_review_time_avg,
                    metrics.meeting_time_hours,
                    metrics.context_switches_per_day
                );

                batch.push(`(
                  '${dev.id}',
                  '${dateStr}',
                  ${metrics.focus_time_hours},
                  ${metrics.pr_merge_time_avg},
                  ${metrics.code_review_time_avg},
                  ${metrics.meeting_time_hours},
                  ${metrics.context_switches_per_day},
                  ${norms.ft},
                  ${norms.prt},
                  ${norms.rt},
                  ${norms.mt},
                  ${norms.cs},
                  ${ddps}
                )`);

                // Insert in batches
                if (batch.length >= batchSize) {
                    await query(conn, `
                      INSERT INTO developer_productivity_snapshots 
                      (developer_id, snapshot_date, focus_time_hours, pr_merge_time_avg, 
                       code_review_time_avg, meeting_time_hours, context_switches_per_day,
                       focus_time_norm, pr_time_norm, review_time_norm, meeting_time_norm,
                       context_switches_norm, ddps_score)
                      VALUES ${batch.join(',')}
                    `);
                    insertCount += batch.length;
                    batch = [];
                    process.stdout.write(`\rInserted ${insertCount} snapshots...`);
                }
            }
        }

        // Insert remaining batch
        if (batch.length > 0) {
            await query(conn, `
              INSERT INTO developer_productivity_snapshots 
              (developer_id, snapshot_date, focus_time_hours, pr_merge_time_avg, 
               code_review_time_avg, meeting_time_hours, context_switches_per_day,
               focus_time_norm, pr_time_norm, review_time_norm, meeting_time_norm,
               context_switches_norm, ddps_score)
              VALUES ${batch.join(',')}
            `);
            insertCount += batch.length;
        }

        console.log(`\nSuccessfully seeded ${insertCount} productivity snapshots`);

        // Show sample data
        const sample = await query(conn, `
          SELECT developer_id, snapshot_date, ddps_score, focus_time_hours, meeting_time_hours
          FROM developer_productivity_snapshots
          ORDER BY snapshot_date DESC
          LIMIT 5
        `);
        console.log('\nSample data:');
        console.table(sample);

    } catch (error) {
        console.error('Error seeding productivity snapshots:', error);
        throw error;
    } finally {
        await conn.end();
    }
}

// Run directly (ESM module)
seedProductivitySnapshots()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
