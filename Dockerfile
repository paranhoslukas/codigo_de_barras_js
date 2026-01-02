# 1. Imagem base: Node.js 20 (LTS) no Debian Slim
FROM node:20-slim

# 2. Instalação das dependências nativas (Poppler e ZBar)
# Atualiza o índice de pacotes
RUN apt-get update && \
    # Instala o Poppler (poppler-utils) e o ZBar (zbar-tools)
    apt-get install -y poppler-utils zbar-tools && \
    # Limpa o cache para reduzir o tamanho da imagem final
    rm -rf /var/lib/apt/lists/*

# 3. Define o diretório de trabalho no container
WORKDIR /app

# 4. Instala as dependências do Node.js
COPY package*.json ./
# Rodar npm install
RUN npm install

# 5. Copia o restante do código da aplicação (server.js, index.html, etc.)
# Certifique-se de que sua pasta 'public' está na raiz do projeto para ser copiada aqui
COPY . .

# 6. Cria diretórios de trabalho e saída
# É importante garantir que o Node.js tenha permissão para escrever aqui
RUN mkdir -p /app/uploads /app/temp_images /app/output

# 7. Expõe a porta que o Express está usando (3000)
EXPOSE 3000

# 8. Comando para iniciar a aplicação
# O 'npm start' deve rodar node server.js
CMD ["npm", "start"]