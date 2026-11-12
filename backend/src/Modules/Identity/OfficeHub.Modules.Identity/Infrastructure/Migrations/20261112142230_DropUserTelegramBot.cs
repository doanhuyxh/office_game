using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Identity.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class DropUserTelegramBot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ux_users_telegram_bot",
                schema: "identity",
                table: "users");

            migrationBuilder.DropColumn(
                name: "TelegramBot",
                schema: "identity",
                table: "users");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TelegramBot",
                schema: "identity",
                table: "users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ux_users_telegram_bot",
                schema: "identity",
                table: "users",
                column: "TelegramBot",
                unique: true,
                filter: "\"TelegramBot\" IS NOT NULL");
        }
    }
}
