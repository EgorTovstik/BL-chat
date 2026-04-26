# frontend/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Копируем package файлы для кэширования зависимостей
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем весь проект
COPY . .

# Открываем порт Vite
EXPOSE 5173

# Запускаем dev сервер с доступом извне контейнера
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]