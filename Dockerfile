# Dockerfile (в корне BL-CHAT/)
FROM python:3.11-slim

WORKDIR /app

# Установка зависимостей
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копируем весь проект
COPY . .

# Создаём папку для логов
RUN mkdir -p logs && chmod 777 logs

EXPOSE 8000

# Запускаем uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]