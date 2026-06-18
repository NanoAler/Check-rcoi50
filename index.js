const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Жестко привязываем путь к директории скрипта, чтобы PM2 не создал файл где-то в /root/
const STATE_FILE = path.join(__dirname, 'last_results.txt');

// Функция отправки сообщения в Telegram
async function sendTelegramMessage(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.log('--- Telegram не настроен. Сообщение: \n' + text);
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    } catch (error) {
        console.error('Ошибка отправки в Telegram:', error.message);
    }
}

async function checkEgeResults() {
    console.log(`[${new Date().toLocaleString()}] Запуск проверки результатов...`);

    // На серверах --no-sandbox обязателен
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]
    });

    const page = await browser.newPage();

    try {
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Шаг 1: Идем на главную
        await page.goto('https://res11.rcoi50.ru/res_exams.aspx', { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('#ctl00_LastName', { timeout: 15000 });

        // Шаг 2: Ввод данных
        await page.click('#ctl00_LastName', { clickCount: 3 });
        await page.type('#ctl00_LastName', process.env.STUDENT_LASTNAME);

        await page.click('#ctl00_FirstName', { clickCount: 3 });
        await page.type('#ctl00_FirstName', process.env.STUDENT_FIRSTNAME);

        await page.click('#ctl00_MidName', { clickCount: 3 });
        await page.type('#ctl00_MidName', process.env.STUDENT_PATRONYMIC);

        await page.click('#ctl00_Number', { clickCount: 3 });
        await page.type('#ctl00_Number', process.env.STUDENT_PASSPORT);

        // Шаг 3: Чекбокс согласия
        const isFirstChecked = await page.evaluate(() => {
            const cb = document.getElementById('ctl00_AcceptDataProcessing');
            return cb ? cb.checked : false;
        });

        if (!isFirstChecked) {
            await Promise.all([
                page.click('#ctl00_AcceptDataProcessing'),
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
            ]);
            await new Promise(r => setTimeout(r, 2000));
        }

        // Шаг 4: Кнопка "Выполнить вход"
        await page.waitForSelector('#ctl00_LoginButton', { timeout: 10000 });
        await Promise.all([
            page.click('#ctl00_LoginButton'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        ]);

        // Шаг 5: Страница правил
        if (page.url().includes('rules.aspx')) {
            await page.waitForSelector('#ctl00_ContentPlaceHolder1_AcceptCheckBox', { timeout: 15000 });

            const isRulesChecked = await page.evaluate(() => {
                const cb = document.getElementById('ctl00_ContentPlaceHolder1_AcceptCheckBox');
                return cb ? cb.checked : false;
            });

            if (!isRulesChecked) {
                await page.click('#ctl00_ContentPlaceHolder1_AcceptCheckBox');
            }

            await page.waitForSelector('#ctl00_ContentPlaceHolder1_AcceptButton', { timeout: 10000 });
            await Promise.all([
                page.click('#ctl00_ContentPlaceHolder1_AcceptButton'),
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
            ]);
        }

        // Шаг 6: Переход к результатам
        await page.goto('https://res11.rcoi50.ru/res_exams.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        // Проверка на ошибку авторизации
        const pageText = await page.evaluate(() => document.body.innerText);
        if (pageText.includes('не найден') || pageText.includes('Ошибка') || pageText.includes('Неверные данные')) {
            console.error('❌ Ошибка: Сайт вернул ошибку авторизации.');
            return;
        }

        // Шаг 7: Парсинг таблицы
        const parsedResults = await page.evaluate(() => {
            const table = document.getElementById('ctl00_ContentPlaceHolder1_ResExams');
            if (!table) return null;

            const rows = Array.from(table.querySelectorAll('tr'));
            const results = [];

            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].querySelectorAll('td');
                if (cells.length >= 5) {
                    results.push({
                        exam: cells[0].innerText.trim(),
                        score: cells[2].innerText.trim()
                    });
                }
            }
            return results;
        });

        if (!parsedResults) {
            console.error('❌ Ошибка: Таблица результатов не найдена.');
            return;
        }

        const currentDataString = JSON.stringify(parsedResults);

        let previousDataString = '';
        if (fs.existsSync(STATE_FILE)) {
            previousDataString = fs.readFileSync(STATE_FILE, 'utf8');
        }

        if (currentDataString !== previousDataString) {
            console.log('🔥 Найдены новые результаты!');
            fs.writeFileSync(STATE_FILE, currentDataString, 'utf8');

            let messageText = `🔔 <b>Обновление результатов!</b>\n\n`;

            parsedResults.forEach(res => {
                const subjectName = res.exam.split(',')[0].trim();
                messageText += `📘 <b>${subjectName}</b>: <tg-spoiler>${res.score}</tg-spoiler>\n`;
            });

            messageText += `\n🔗 <a href="https://res11.rcoi50.ru/res_exams.aspx">Перейти на сайт</a>`;
            await sendTelegramMessage(messageText);
        } else {
            console.log('😴 Изменений нет.');
        }

    } catch (error) {
        console.error('💥 Критическая ошибка:', error.message);
    } finally {
        await browser.close();
    }
}

const interval = process.env.CHECK_INTERVAL_MINUTES || 15;
console.log(`Скрипт запущен (Cron). Интервал: ${interval} мин.`);

checkEgeResults();

cron.schedule(`*/${interval} * * * *`, () => {
    checkEgeResults();
});
