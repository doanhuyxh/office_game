using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "audit");

            migrationBuilder.CreateTable(
                name: "ai_requests",
                schema: "audit",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ViaOAuth = table.Column<bool>(type: "boolean", nullable: false),
                    Tool = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Method = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Path = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    DurationMs = table.Column<int>(type: "integer", nullable: false),
                    Ip = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ai_requests", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_ai_requests_time",
                schema: "audit",
                table: "ai_requests",
                column: "OccurredAt");

            migrationBuilder.CreateIndex(
                name: "ix_ai_requests_user_time",
                schema: "audit",
                table: "ai_requests",
                columns: new[] { "UserId", "OccurredAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ai_requests",
                schema: "audit");
        }
    }
}
