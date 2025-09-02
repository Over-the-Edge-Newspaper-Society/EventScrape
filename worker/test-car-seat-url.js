// Quick test to load the Car Seat Clinic page and extract series data
import { chromium } from 'playwright';

async function testCarSeatClinicPage() {
    console.log('🧪 Testing Car Seat Clinic page loading and parsing...\n');
    
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        console.log('⏳ Loading page...');
        await page.goto('https://www.princegeorge.ca/community-culture/arts-events/events-calendar/car-seat-clinic-fire-hall-1', { 
            waitUntil: 'networkidle',
            timeout: 30000 
        });
        console.log('✅ Page loaded successfully');
        
        // Extract the series data using the same logic as the Prince George module
        const result = await page.evaluate(() => {
            // Extract event types
            const eventTypeEl = document.querySelector('.field--name-field-types .field__item');
            const communityTypeEl = document.querySelector('.field--name-field-types2 .field__item');
            const eventType = eventTypeEl?.textContent?.trim();
            const communityType = communityTypeEl?.textContent?.trim();

            // Extract location
            const locationEl = document.querySelector('.field--name-field-contact-information .field__item');
            const location = locationEl?.textContent?.trim();

            // Extract description from the main body field
            const descriptionEl = document.querySelector('.field--name-body.field--type-text-with-summary .field__item') || 
                                document.querySelector('.field--name-body .field__item') ||
                                document.querySelector('.field--name-body.field--type-text-with-summary') ||
                                document.querySelector('.field--name-body');
            const description = descriptionEl?.innerHTML?.trim();

            // Extract image
            const imageEl = document.querySelector('.field--name-field-media-image img');
            const imageUrl = imageEl?.src;

            // Extract ALL date instances (series) from the when field
            const dateItems = Array.from(document.querySelectorAll('.field--name-field-when .field__item'));
            const dates = [];
            dateItems.forEach(item => {
                const times = item.querySelectorAll('time[datetime]');
                if (times.length >= 1) {
                    const start = times[0].getAttribute('datetime') || '';
                    const endAttr = times[1]?.getAttribute('datetime') || undefined;
                    if (start) dates.push({ start, end: endAttr || undefined });
                }
            });

            return {
                eventType,
                communityType,
                location,
                description,
                imageUrl,
                startDateTime: dates[0]?.start || null,
                endDateTime: dates[0]?.end || null,
                dates,
                pageTitle: document.title,
                pageUrl: window.location.href,
                whenFieldFound: !!document.querySelector('.field--name-field-when'),
                whenFieldItemsCount: document.querySelectorAll('.field--name-field-when .field__item').length,
                timeElementsCount: document.querySelectorAll('.field--name-field-when time[datetime]').length
            };
        });

        console.log('📊 Extraction Results:');
        console.log(`   Page Title: ${result.pageTitle}`);
        console.log(`   Event Type: ${result.eventType}`);
        console.log(`   Community Type: ${result.communityType}`);
        console.log(`   Location: ${result.location}`);
        console.log(`   When field found: ${result.whenFieldFound}`);
        console.log(`   When field items: ${result.whenFieldItemsCount}`);
        console.log(`   Time elements: ${result.timeElementsCount}`);
        console.log(`   Series dates extracted: ${result.dates.length}`);
        
        if (result.dates.length > 0) {
            console.log('\n📅 Series Dates:');
            result.dates.forEach((date, index) => {
                const startDate = new Date(date.start);
                const endDate = date.end ? new Date(date.end) : null;
                console.log(`   ${index + 1}. ${startDate.toLocaleDateString('en-US', { 
                    weekday: 'short', 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric' 
                })} ${startDate.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit', 
                    hour12: true 
                })} - ${endDate?.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit', 
                    hour12: true 
                }) || 'N/A'}`);
            });
        }
        
        if (result.description) {
            console.log(`\n📝 Description found: ${result.description.length} characters`);
            if (result.description.includes('Every Wednesday in September')) {
                console.log('   ✅ Contains recurring series information');
            }
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    } finally {
        await browser.close();
    }
}

testCarSeatClinicPage();