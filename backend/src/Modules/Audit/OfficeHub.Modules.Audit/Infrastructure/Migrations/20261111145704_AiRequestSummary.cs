using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Audit.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AiRequestSummary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RequestSummary",
                schema: "audit",
                table: "ai_requests",
                type: "jsonb",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RequestSummary",
                schema: "audit",
                table: "ai_requests");
        }
    }
}
