using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace OfficeHub.Modules.Chat.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialChat : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "chat");

            migrationBuilder.CreateTable(
                name: "conversations",
                schema: "chat",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RoomId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    UserLowId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserHighId = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    LastSeq = table.Column<long>(type: "bigint", nullable: false),
                    LastMessageAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastPreview = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_conversations", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "messages",
                schema: "chat",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Seq = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityAlwaysColumn),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    SenderId = table.Column<Guid>(type: "uuid", nullable: false),
                    SenderName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Text = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    DeletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ClientId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_messages", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "read_states",
                schema: "chat",
                columns: table => new
                {
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    LastReadSeq = table.Column<long>(type: "bigint", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_read_states", x => new { x.ConversationId, x.UserId });
                });

            migrationBuilder.CreateTable(
                name: "room_members",
                schema: "chat",
                columns: table => new
                {
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    JoinedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_room_members", x => new { x.ConversationId, x.UserId });
                });

            migrationBuilder.CreateTable(
                name: "upload_tickets",
                schema: "chat",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ConversationId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_upload_tickets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "attachments",
                schema: "chat",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    MessageId = table.Column<Guid>(type: "uuid", nullable: false),
                    FileKey = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    IsImage = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_attachments_messages_MessageId",
                        column: x => x.MessageId,
                        principalSchema: "chat",
                        principalTable: "messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_attachments_message",
                schema: "chat",
                table: "attachments",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "ix_conversations_high",
                schema: "chat",
                table: "conversations",
                column: "UserHighId");

            migrationBuilder.CreateIndex(
                name: "ux_conversations_direct",
                schema: "chat",
                table: "conversations",
                columns: new[] { "UserLowId", "UserHighId" },
                unique: true,
                filter: "\"UserLowId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_conversations_office",
                schema: "chat",
                table: "conversations",
                column: "Type",
                unique: true,
                filter: "\"Type\" = 'Office'");

            migrationBuilder.CreateIndex(
                name: "ux_conversations_room",
                schema: "chat",
                table: "conversations",
                column: "RoomId",
                unique: true,
                filter: "\"RoomId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_messages_conversation_seq",
                schema: "chat",
                table: "messages",
                columns: new[] { "ConversationId", "Seq" });

            migrationBuilder.CreateIndex(
                name: "ux_messages_client",
                schema: "chat",
                table: "messages",
                columns: new[] { "ConversationId", "SenderId", "ClientId" },
                unique: true,
                filter: "\"ClientId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_messages_seq",
                schema: "chat",
                table: "messages",
                column: "Seq",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_read_states_user",
                schema: "chat",
                table: "read_states",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ix_room_members_user",
                schema: "chat",
                table: "room_members",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "ix_upload_tickets_created",
                schema: "chat",
                table: "upload_tickets",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attachments",
                schema: "chat");

            migrationBuilder.DropTable(
                name: "conversations",
                schema: "chat");

            migrationBuilder.DropTable(
                name: "read_states",
                schema: "chat");

            migrationBuilder.DropTable(
                name: "room_members",
                schema: "chat");

            migrationBuilder.DropTable(
                name: "upload_tickets",
                schema: "chat");

            migrationBuilder.DropTable(
                name: "messages",
                schema: "chat");
        }
    }
}
