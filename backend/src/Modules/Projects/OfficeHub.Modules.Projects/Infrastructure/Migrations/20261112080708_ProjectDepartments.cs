using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Projects.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ProjectDepartments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "project_departments",
                schema: "projects",
                columns: table => new
                {
                    ProjectId = table.Column<Guid>(type: "uuid", nullable: false),
                    DepartmentId = table.Column<Guid>(type: "uuid", nullable: false),
                    IsLead = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_departments", x => new { x.ProjectId, x.DepartmentId });
                    table.ForeignKey(
                        name: "FK_project_departments_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalSchema: "projects",
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_project_departments_department",
                schema: "projects",
                table: "project_departments",
                column: "DepartmentId");

            // TEST-40: phòng ban cũ (một phòng / dự án) → phòng chủ trì, rồi mới bỏ cột — không mất dữ liệu.
            migrationBuilder.Sql(@"INSERT INTO projects.project_departments (""ProjectId"", ""DepartmentId"", ""IsLead"", ""CreatedAt"")
                SELECT ""Id"", ""DepartmentId"", TRUE, now() FROM projects.projects WHERE ""DepartmentId"" IS NOT NULL;");

            migrationBuilder.DropColumn(
                name: "DepartmentId",
                schema: "projects",
                table: "projects");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "DepartmentId",
                schema: "projects",
                table: "projects",
                type: "uuid",
                nullable: true);

            migrationBuilder.Sql(@"UPDATE projects.projects p SET ""DepartmentId"" = d.""DepartmentId""
                FROM projects.project_departments d WHERE d.""ProjectId"" = p.""Id"" AND d.""IsLead"";");

            migrationBuilder.DropTable(
                name: "project_departments",
                schema: "projects");
        }
    }
}
