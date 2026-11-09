# Một image cho CẢ Api, Realtime và Mcp (build một lần, tiết kiệm ổ cứng). Chạy từ gốc repo (cần thư mục shared/):
#   docker build -f backend/Dockerfile -t officehub/backend .
# Chọn service khi chạy: biến SERVICE=OfficeHub.Api | OfficeHub.Realtime | OfficeHub.Mcp (docker-compose đặt sẵn).
FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY backend/ ./
# Identity nhúng shared/avatar-catalog.json lúc build (đường dẫn ../../../../../shared tính từ project → /shared)
COPY shared/ /shared/
RUN dotnet publish src/OfficeHub.Api/OfficeHub.Api.csproj -c Release -o /out/OfficeHub.Api \
 && dotnet publish src/OfficeHub.Realtime/OfficeHub.Realtime.csproj -c Release -o /out/OfficeHub.Realtime \
 && dotnet publish src/OfficeHub.Mcp/OfficeHub.Mcp.csproj -c Release -o /out/OfficeHub.Mcp

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
# icu: định dạng / văn hoá vi-VN · tzdata: múi giờ Asia/Ho_Chi_Minh · krb5-libs: Npgsql (libgssapi)
RUN apk add --no-cache icu-libs tzdata krb5-libs
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false \
    SERVICE=OfficeHub.Api
WORKDIR /app
COPY --from=build /out ./
COPY shared/ ./shared/
# Phiên bản (trang Hệ thống → Vận hành): scripts/deploy.sh truyền commit + giờ build. Đặt cuối để không phá cache các lớp trên.
ARG GIT_SHA=unknown
ARG BUILD_TIME=
ENV OFFICEHUB_COMMIT=$GIT_SHA \
    OFFICEHUB_BUILD_TIME=$BUILD_TIME
# Thư mục khoá DataProtection (volume "keys"): tạo sẵn với quyền user app — volume mới sẽ chép quyền này, không thì Permission denied
RUN mkdir -p /keys && chown $APP_UID:$APP_UID /keys
USER $APP_UID
# Content root = thư mục của service (appsettings.json riêng)
ENTRYPOINT ["sh", "-c", "cd /app/$SERVICE && exec dotnet $SERVICE.dll"]
