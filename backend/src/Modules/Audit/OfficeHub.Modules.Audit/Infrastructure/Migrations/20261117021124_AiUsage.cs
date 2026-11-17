using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AiUsage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ai_usage_sessions",
                schema: "audit",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: true),
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: true),
                    TaskCode = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Executor = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Status = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Turns = table.Column<int>(type: "integer", nullable: true),
                    CostUsd = table.Column<decimal>(type: "numeric(12,6)", precision: 12, scale: 6, nullable: true),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_usage_sessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ai_usage_models",
                schema: "audit",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionId = table.Column<Guid>(type: "uuid", nullable: false),
                    Model = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    InputTokens = table.Column<long>(type: "bigint", nullable: true),
                    OutputTokens = table.Column<long>(type: "bigint", nullable: true),
                    CacheReadTokens = table.Column<long>(type: "bigint", nullable: true),
                    CacheWriteTokens = table.Column<long>(type: "bigint", nullable: true),
                    CostUsd = table.Column<decimal>(type: "numeric(12,6)", precision: 12, scale: 6, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_usage_models", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ai_usage_models_ai_usage_sessions_SessionId",
                        column: x => x.SessionId,
                        principalSchema: "audit",
                        principalTable: "ai_usage_sessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ux_ai_usage_models_session_model",
                schema: "audit",
                table: "ai_usage_models",
                columns: new[] { "SessionId", "Model" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_ai_usage_sessions_time",
                schema: "audit",
                table: "ai_usage_sessions",
                column: "FinishedAt");

            migrationBuilder.CreateIndex(
                name: "ix_ai_usage_sessions_user_time",
                schema: "audit",
                table: "ai_usage_sessions",
                columns: new[] { "UserId", "FinishedAt" });

            migrationBuilder.CreateIndex(
                name: "ux_ai_usage_sessions_source",
                schema: "audit",
                table: "ai_usage_sessions",
                columns: new[] { "UserId", "SourceId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_usage_models",
                schema: "audit");

            migrationBuilder.DropTable(
                name: "ai_usage_sessions",
                schema: "audit");
        }
    }
}
