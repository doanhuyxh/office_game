# Build một trong hai service:  docker build -f backend/Dockerfile --build-arg SERVICE=OfficeHub.Api .
# (chạy từ gốc repo vì cần thư mục shared/)
ARG SERVICE=OfficeHub.Api

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG SERVICE
WORKDIR /src
COPY backend/ ./
RUN dotnet publish src/$SERVICE/$SERVICE.csproj -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
ARG SERVICE
# Npgsql cần libgssapi (Kerberos) — thiếu thì log báo lỗi mỗi lần kết nối
RUN apt-get update && apt-get install -y --no-install-recommends libgssapi-krb5-2 && rm -rf /var/lib/apt/lists/*
ENV SERVICE_DLL=$SERVICE.dll
WORKDIR /app
COPY --from=build /out ./
COPY shared/ ./shared/
USER $APP_UID
ENTRYPOINT ["sh", "-c", "exec dotnet $SERVICE_DLL"]
