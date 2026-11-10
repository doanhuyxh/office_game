using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TaskWorkflowAndBot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CreatedByBot",
                schema: "projects",
                table: "tasks",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "ByBot",
                schema: "projects",
                table: "task_comments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "RequireReview",
                schema: "projects",
                table: "projects",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "WorkGuide",
                schema: "projects",
                table: "projects",
                type: "character varying(20000)",
                maxLength: 20000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "task_activities",
                schema: "projects",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    Kind = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    From = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    To = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ActorEmployeeId = table.Column<Guid>(type: "uuid", nullable: true),
                    ActorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ByBot = table.Column<bool>(type: "boolean", nullable: false),
                    At = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_task_activities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_task_activities_tasks_TaskId",
                        column: x => x.TaskId,
                        principalSchema: "projects",
                        principalTable: "tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_task_activities_task",
                schema: "projects",
                table: "task_activities",
                columns: new[] { "TaskId", "At" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "task_activities",
                schema: "projects");

            migrationBuilder.DropColumn(
                name: "CreatedByBot",
                schema: "projects",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "ByBot",
                schema: "projects",
                table: "task_comments");

            migrationBuilder.DropColumn(
                name: "RequireReview",
                schema: "projects",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "WorkGuide",
                schema: "projects",
                table: "projects");
        }
    }
}
