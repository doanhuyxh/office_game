using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TaskCommentUploadLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClientIp",
                schema: "projects",
                table: "task_comments",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "UploadLinkId",
                schema: "projects",
                table: "task_comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UserAgent",
                schema: "projects",
                table: "task_comments",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "UploadLinkId",
                schema: "projects",
                table: "comment_upload_tickets",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "comment_upload_links",
                schema: "projects",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RevokedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FileCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_comment_upload_links", x => x.Id);
                    table.ForeignKey(
                        name: "FK_comment_upload_links_tasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "projects",
                        principalTable: "tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_comment_upload_tickets_link",
                schema: "projects",
                table: "comment_upload_tickets",
                column: "UploadLinkId");

            migrationBuilder.CreateIndex(
                name: "ix_comment_upload_links_task_user",
                schema: "projects",
                table: "comment_upload_links",
                columns: new[] { "TaskId", "UserId" });

            migrationBuilder.CreateIndex(
                name: "ux_comment_upload_links_token",
                schema: "projects",
                table: "comment_upload_links",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "comment_upload_links",
                schema: "projects");

            migrationBuilder.DropIndex(
                name: "ix_comment_upload_tickets_link",
                schema: "projects",
                table: "comment_upload_tickets");

            migrationBuilder.DropColumn(
                name: "ClientIp",
                schema: "projects",
                table: "task_comments");

            migrationBuilder.DropColumn(
                name: "UploadLinkId",
                schema: "projects",
                table: "task_comments");

            migrationBuilder.DropColumn(
                name: "UserAgent",
                schema: "projects",
                table: "task_comments");

            migrationBuilder.DropColumn(
                name: "UploadLinkId",
                schema: "projects",
                table: "comment_upload_tickets");
        }
    }
}
