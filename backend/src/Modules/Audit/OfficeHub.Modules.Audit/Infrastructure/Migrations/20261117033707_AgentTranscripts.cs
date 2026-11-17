using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AgentTranscripts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_transcripts",
                schema: "audit",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Kind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    SessionId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Cwd = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Branch = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SummaryEncrypted = table.Column<string>(type: "text", nullable: true),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    StorageKey = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_transcripts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_agent_transcripts_expires",
                schema: "audit",
                table: "agent_transcripts",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "ix_agent_transcripts_updated",
                schema: "audit",
                table: "agent_transcripts",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "ux_agent_transcripts_user_key",
                schema: "audit",
                table: "agent_transcripts",
                columns: new[] { "UserId", "Key" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_transcripts",
                schema: "audit");
        }
    }
}
