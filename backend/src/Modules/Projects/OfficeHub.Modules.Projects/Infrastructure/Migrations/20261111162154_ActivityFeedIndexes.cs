using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ActivityFeedIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "ix_task_comments_time",
                schema: "projects",
                table: "task_comments",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "ix_task_activities_time",
                schema: "projects",
                table: "task_activities",
                column: "At");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_task_comments_time",
                schema: "projects",
                table: "task_comments");

            migrationBuilder.DropIndex(
                name: "ix_task_activities_time",
                schema: "projects",
                table: "task_activities");
        }
    }
}
