using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Chat.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ChatByBot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "ByBot",
                schema: "chat",
                table: "messages",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "ix_messages_bot_sender_time",
                schema: "chat",
                table: "messages",
                columns: new[] { "SenderId", "CreatedAt" },
                filter: "\"ByBot\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_messages_bot_sender_time",
                schema: "chat",
                table: "messages");

            migrationBuilder.DropColumn(
                name: "ByBot",
                schema: "chat",
                table: "messages");
        }
    }
}
