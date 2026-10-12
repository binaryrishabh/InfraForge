import "dotenv/config"

export const config = {
    PORT: process.env.PORT || 3000,
    LISTEN_HOST: process.env.LISTEN_HOST || "0.0.0.0",
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV || "development"
}
