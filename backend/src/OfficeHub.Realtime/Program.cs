using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Realtime.Auth;
using OfficeHub.Realtime.Chat;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Hosting;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Realtime.Hubs;
using OfficeHub.Realtime.Simulation;
using OfficeHub.Realtime.Voice;

EnvLoader.Load();
var builder = WebApplication.CreateBuilder(args);
builder.AddOfficeHubDefaults("officehub-realtime");

// Đọc cookie do OfficeHub.Api cấp (cùng scheme, cùng tên cookie, cùng khoá DataProtection).
builder.Services.AddAuthentication(AuthCookie.Scheme).AddCookie(AuthCookie.Scheme, AuthCookie.Configure);
builder.Services.AddAuthorization();

// Kiểm tra phiên qua OfficeHub.Api (tài khoản bị khoá → đẩy khỏi văn phòng)
builder.Services.AddOptions<RealtimeSettings>().Bind(builder.Configuration.GetSection(RealtimeSettings.Section));
var apiBase = builder.Configuration.GetSection(RealtimeSettings.Section).Get<RealtimeSettings>()?.ApiBaseUrl ?? new RealtimeSettings().ApiBaseUrl;
// UseCookies = false: mỗi request mang cookie của CHÍNH người chơi (header Cookie tự đặt). Mặc định handler (dùng chung trong pool)
// có CookieContainer → lưu Set-Cookie gia hạn của người A rồi gửi kèm cho request của người B → kiểm tra phiên / đọc nhân vật nhầm người.
builder.Services.AddHttpClient(SessionValidator.HttpClientName, c => { c.BaseAddress = new Uri(apiBase); c.Timeout = TimeSpan.FromSeconds(5); })
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseCookies = false });
builder.Services.AddSingleton<SessionValidator>();
// Hỏi phiên họp agent mỗi 3 giây (TEST-76): client riêng, không ghi log từng request
builder.Services.AddHttpClient(AgentMeetingWatch.HttpClientName, c => { c.BaseAddress = new Uri(apiBase); c.Timeout = TimeSpan.FromSeconds(5); })
    .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseCookies = false }).RemoveAllLoggers();
builder.Services.AddHostedService<SessionWatch>();

// Chat (tin nhắn): Api lưu, Realtime chỉ chuyển tiếp + phát. Khoá nội bộ để báo "ai vừa vào phòng nào".
builder.Services.AddOptions<ChatSettings>().Bind(builder.Configuration.GetSection(ChatSettings.Section)).ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddSingleton<ChatConnections>();
builder.Services.AddSingleton<ChatApi>();
builder.Services.AddSingleton<ChatFanout>();
builder.Services.AddHostedService<ChatSessionWatch>();

builder.Services.AddSignalR(o => o.MaximumReceiveMessageSize = 16 * 1024).AddMessagePackProtocol();

var mapPath = EnvLoader.ResolvePath(builder.Configuration["Realtime:MapPath"] ?? "shared/office-map.json", builder.Environment.ContentRootPath);
builder.Services.AddSingleton(OfficeMap.Load(mapPath));
builder.Services.AddSingleton<Presence>();
builder.Services.AddSingleton<BotPresence>();
builder.Services.AddSingleton<BotActivityFeed>(); // luồng "agent đang làm gì" (RAM, TEST-92)
builder.Services.AddHostedService<BotSweeper>();
builder.Services.AddHostedService<AgentMeetingWatch>(); // họp agent: bot đi vào / rời phòng họp (TEST-76)
builder.Services.AddSingleton<OfficeHub.Realtime.Screens.RoomScreens>();
builder.Services.AddSingleton<OfficeHub.Realtime.Screens.BotScreens>(); // bot chiếu màn hình (RAM)
builder.Services.AddHostedService<OfficeLoop>();
builder.Services.AddOptions<LiveKitSettings>()
    .Bind(builder.Configuration.GetSection(LiveKitSettings.Section))
    .Validate(s => !s.Enabled || s.ApiSecret!.Length >= 32, "LiveKit__ApiSecret phải dài tối thiểu 32 ký tự (openssl rand -base64 32)")
    .ValidateOnStart();
builder.Services.AddSingleton<VoiceGuard>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<VoiceGuard>());

var app = builder.Build();
app.UseOfficeHubDefaults();
app.UseCsrfGuard();       // negotiate (POST) + bắt tay WebSocket phải đến từ chính trang (chống Cross-Site WebSocket Hijacking)
app.UseInternalRouteGuard(); // /rt/internal/*: kiểm khoá + giới hạn body TRƯỚC khi đọc body (Hubs/InternalRouteGuard.cs)
app.UseAuthentication();
app.UseAuthorization();

app.MapHub<OfficeRoomHub>(OfficeRoomHub.Path);
app.MapHub<ChatHub>(ChatHub.Path);
app.MapVoice();
app.MapBots();
app.MapBotActivityFeed(); // /rt/internal/bot-activity-feed (khoá nội bộ)
app.MapBotScreens(); // bot chiếu lên TV phòng + ảnh khung mới nhất /rt/screens/…   // OfficeHub.Mcp báo bot đang làm việc (khoá nội bộ)

app.Run();
