using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class TaskReviewer : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ReviewerEmployeeId",
                schema: "projects",
                table: "tasks",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsReview",
                schema: "projects",
                table: "task_columns",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // TEST-161: cột "Chờ review" sẵn có (mặc định của dự án) thành cột review.
            migrationBuilder.Sql("""UPDATE projects.task_columns SET "IsReview" = TRUE WHERE "Name" = 'Chờ review';""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ReviewerEmployeeId",
                schema: "projects",
                table: "tasks");

            migrationBuilder.DropColumn(
                name: "IsReview",
                schema: "projects",
                table: "task_columns");
        }
    }
}
