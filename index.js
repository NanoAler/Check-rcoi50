const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');
const cron = require('node-cron');
require('dotenv').config();

const STATE_FILE = 'last_results.txt';

// Функция отправки сообщения в Telegram
async function sendTelegramMessage(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
        console.log('--- Telegram не настроен. Сообщение: ' + text);
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        });
    } catch (error) {
        console.error('Ошибка отправки в Telegram:', error.message);
    }
}

async function checkEgeResults() {
    console.log(`[${new Date().toLocaleString()}] Запуск проверки результатов...`);
    
    const browser = await puppeteer.launch({ 
        headless: true, // Поменяйте на false для отладки, чтобы видеть действия браузера
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const page = await browser.newPage();
    
    try {
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Шаг 1: Переход на стартовую страницу
        await page.goto('https://res11.rcoi50.ru/default.aspx', { waitUntil: 'networkidle2', timeout: 60000 });
        await page.waitForSelector('#ctl00_LastName', { timeout: 15000 });

        // Шаг 2: Заполнение ФИО и Паспорта
        await page.click('#ctl00_LastName', { clickCount: 3 });
        await page.type('#ctl00_LastName', process.env.STUDENT_LASTNAME);

        await page.click('#ctl00_FirstName', { clickCount: 3 });
        await page.type('#ctl00_FirstName', process.env.STUDENT_FIRSTNAME);

        await page.click('#ctl00_MidName', { clickCount: 3 });
        await page.type('#ctl00_MidName', process.env.STUDENT_PATRONYMIC);

        await page.click('#ctl00_Number', { clickCount: 3 });
        await page.type('#ctl00_Number', process.env.STUDENT_PASSPORT);

        // Шаг 3: Нажатие на первый чекбокс (Согласие на обработку перс. данных)
        const isFirstChecked = await page.evaluate(() => {
            const cb = document.getElementById('ctl00_AcceptDataProcessing');
            return cb ? cb.checked : false;
        });

        if (!isFirstChecked) {
            console.log('Нажимаем первый чекбокс и ждем частичной перезагрузки страницы...');
            await Promise.all([
                page.click('#ctl00_AcceptDataProcessing'),
                // Так как это частичный PostBack, сеть должна на мгновение активироваться и затихнуть
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {
                    // Если полноценной перезагрузки не было (AJAX), просто идем дальше после паузы
                })
            ]);
            await new Promise(r => setTimeout(r, 2000)); // Жесткая пауза для надежности
        }

        // Шаг 4: Нажатие кнопки "Выполнить вход"
        console.log('Нажимаем кнопку "Выполнить вход"...');
        await page.waitForSelector('#ctl00_LoginButton', { timeout: 10000 });
        await Promise.all([
            page.click('#ctl00_LoginButton'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        ]);

        // Шаг 5: Обработка страницы правил (rules.aspx)
        console.log('Перешли на страницу правил. Проверяем URL...');
        const currentUrl = page.url();
        
        if (currentUrl.includes('rules.aspx')) {
            console.log('Принимаем правила использования сайта...');
            
            // Ждем чекбокс «Мною прочитаны и осознаны...»
            await page.waitForSelector('#ctl00_ContentPlaceHolder1_AcceptCheckBox', { timeout: 15000 });
            
            // Проверяем, нажат ли он
            const isRulesChecked = await page.evaluate(() => {
                const cb = document.getElementById('ctl00_ContentPlaceHolder1_AcceptCheckBox');
                return cb ? cb.checked : false;
            });

            if (!isRulesChecked) {
                await page.click('#ctl00_ContentPlaceHolder1_AcceptCheckBox');
            }

            // Нажимаем кнопку "Отправить" на странице правил
            await page.waitForSelector('#ctl00_ContentPlaceHolder1_AcceptButton', { timeout: 10000 });
            await Promise.all([
                page.click('#ctl00_ContentPlaceHolder1_AcceptButton'),
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {})
            ]);
        }

        // Шаг 6: Принудительный переход на страницу результатов
        console.log('Переходим на страницу результатов res_exams.aspx...');
        await page.goto('https://res11.rcoi50.ru/res_exams.aspx', { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000)); // Даем таблице отрендериться

        // Шаг 7: Парсинг таблицы результатов
        console.log('Анализируем таблицу результатов...');
        
        const parsedResults = await page.evaluate(() => {
            const table = document.getElementById('ctl00_ContentPlaceHolder1_ResExams');
            if (!table) return null; // Если таблицы нет, возвращаем null
            
            const rows = Array.from(table.querySelectorAll('tr'));
            const results = [];
            
            // Начинаем с 1, чтобы пропустить первую строку с заголовками (Экзамен, Вариант и т.д.)
            for (let i = 1; i < rows.length; i++) {
                const cells = rows[i].querySelectorAll('td');
                if (cells.length >= 5) {
                    results.push({
                        exam: cells[0].innerText.trim(),  // Название и дата
                        variant: cells[1].innerText.trim(), // Вариант
                        score: cells[2].innerText.trim(),   // Балл
                        mark: cells[3].innerText.trim(),    // Отметка / Зачет
                        status: cells[4].innerText.trim()   // Статус результата
                    });
                }
            }
            return results;
        });

        // Если таблица не найдена (возможно, ошибка на странице)
        if (!parsedResults) {
            console.error('❌ Ошибка: Таблица результатов не найдена на странице.');
            return;
        }

        // Преобразуем массив результатов в строку для сравнения
        const currentDataString = JSON.stringify(parsedResults);

        // Читаем предыдущие сохраненные результаты
        let previousDataString = '';
        if (fs.existsSync(STATE_FILE)) {
            previousDataString = fs.readFileSync(STATE_FILE, 'utf8');
        }
        // Сравниваем
        if (currentDataString !== previousDataString) {
            console.log('🔥 Найдены новые результаты или это первый запуск!');
            
            // Сохраняем новые данные в файл
            fs.writeFileSync(STATE_FILE, currentDataString, 'utf8');

            // Формируем краткое сообщение для Telegram
            let messageText = `🔔 <b>Обновление результатов!</b>\n\n`;
            
            parsedResults.forEach(res => {
                // Отрезаем дату после запятой, оставляя только предмет (например, "РУС-11")
                const subjectName = res.exam.split(',')[0].trim();
                
                messageText += `📘 <b>${subjectName}</b>: <tg-spoiler>${res.score}</tg-spoiler>\n`;
            });

            messageText += `\n🔗 <a href="https://res11.rcoi50.ru/res_exams.aspx">Перейти на сайт</a>`;

            // Отправляем уведомление
            await sendTelegramMessage(messageText);
        } else {
            console.log('😴 Изменений в таблице нет. Ждем дальше.');
        }

    } catch (error) {
        console.error('💥 Произошла критическая ошибка:', error.message);
    } finally {
        await browser.close();
    }
}

// Настройка планировщика (Cron)
const interval = process.env.CHECK_INTERVAL_MINUTES || 15;
console.log(`Скрипт успешно запущен. Интервал проверки: каждые ${interval} мин.`);

// Первый запуск при старте приложения
checkEgeResults();

// Повторяющиеся запуски
cron.schedule(`*/${interval} * * * *`, () => {
    checkEgeResults();
});
