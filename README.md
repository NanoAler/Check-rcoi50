# Check EGE Notifier (RCOI 50)

Скрипт автоматической проверки результатов экзаменов (ЕГЭ/ОГЭ) на сайте РЦОИ Московской области (`res11.rcoi50.ru`) с уведомлением в Telegram.

## 🚀 Возможности

- Полный обход цепочки авторизации ASP.NET (включая чекбокс согласия персональных данных и страницу правил `rules.aspx`).
- Точечный парсинг таблицы результатов (без ложных срабатываний).
- Компактные уведомления в Telegram (только предмет и балл).
- Работа по расписанию (Cron).

## 🛠 Установка

1. Склонируйте репозиторий:

```bash
git clone https://github.com/NanoAler/Check-rcoi50.git
cd Check-rcoi50
npm install
```

2. Создайте файл `.env` в корне проекта и заполните его:

```env
STUDENT_LASTNAME=Иванов
STUDENT_FIRSTNAME=Иван
STUDENT_PATRONYMIC=Иванович
STUDENT_PASSPORT=123456

TELEGRAM_BOT_TOKEN=ваш_токен
TELEGRAM_CHAT_ID=ваш_id
CHECK_INTERVAL_MINUTES=15
```

3. Запустите скрипт:

```bash
node index.js
```

## 🕐 Настройка Cron (опционально)

Для регулярной проверки по расписанию добавьте задачу в `crontab`:

```bash
crontab -e
```

Пример: проверка каждые 15 минут:

```cron
*/15 * * * * cd /путь/к/Check-rcoi50 && /usr/bin/node index.js >> /var/log/check_rcoi50.log 2>&1
```

## 📦 Зависимости

- [axios](https://www.npmjs.com/package/axios) — HTTP-клиент
- [cheerio](https://www.npmjs.com/package/cheerio) — парсинг HTML
- [dotenv](https://www.npmjs.com/package/dotenv) — загрузка переменных окружения

## 📄 Лицензия

MIT

## ⚠️ Отказ от ответственности

Данный скрипт предоставляется «как есть» и предназначен только для личного использования. Автор не несёт ответственности за любые последствия, связанные с его использованием.
