using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace OfficeHub.Modules.Meetings.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialMeetings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "meetings");

            migrationBuilder.CreateTable(
                name: "bookings",
                schema: "meetings",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RoomId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    EndAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    OrganizerEmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganizerUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    OrganizerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CancelledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_bookings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "attendees",
                schema: "meetings",
                columns: table => new
                {
                    BookingId = table.Column<Guid>(type: "uuid", nullable: false),
                    EmployeeId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_attendees", x => new { x.BookingId, x.EmployeeId });
                    table.ForeignKey(
                        name: "FK_attendees_bookings_BookingId",
                        column: x => x.BookingId,
                        principalSchema: "meetings",
                        principalTable: "bookings",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_attendees_employee",
                schema: "meetings",
                table: "attendees",
                column: "EmployeeId");

            migrationBuilder.CreateIndex(
                name: "ix_bookings_room_start",
                schema: "meetings",
                table: "bookings",
                columns: new[] { "RoomId", "StartAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "attendees",
                schema: "meetings");

            migrationBuilder.DropTable(
                name: "bookings",
                schema: "meetings");
        }
    }
}
