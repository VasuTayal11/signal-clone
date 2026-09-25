from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="forbid")

    app_name: str = "Signal Clone API"
    database_url: str = "sqlite:///./signal.db"
    fixed_otp: str = "123456"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"


settings = Settings()
