using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TaskWakeFollowers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // TEST-178: bỏ người review — người review cũ thành người theo dõi (chưa có thì thêm), rồi mới xoá cột.
            migrationBuilder.Sql("""
                INSERT INTO projects.task_followers ("TaskId", "EmployeeId", "CreatedAt")
                SELECT "Id", "ReviewerEmployeeId", now() FROM projects.tasks WHERE "ReviewerEmployeeId" IS NOT NULL
                ON CONFLICT ("TaskId", "EmployeeId") DO NOTHING;
                """);

            migrationBuilder.DropColumn(
                name: "ReviewerEmployeeId",
                schema: "projects",
                table: "tasks");

            migrationBuilder.RenameColumn(
                name: "IsReview",
                schema: "projects",
                table: "task_columns",
                newName: "WakeFollowers");

            // Cột hoàn thành cũng đánh thức bot theo dõi → dự án đang chạy giữ hành vi task_done cũ (bot DevOps theo dõi việc sang Xong).
            migrationBuilder.Sql("""UPDATE projects.task_columns SET "WakeFollowers" = TRUE WHERE "IsDone";""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "WakeFollowers",
                schema: "projects",
                table: "task_columns",
                newName: "IsReview");

            migrationBuilder.AddColumn<Guid>(
                name: "ReviewerEmployeeId",
                schema: "projects",
                table: "tasks",
                type: "uuid",
                nullable: true);
        }
    }
}
