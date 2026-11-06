export interface IMeetingRoom {
  id: string;
  name: string;
  capacity: number;
}

export interface IAttendee {
  employeeId: string;
  name: string;
}

/** Khớp BookingDto. startAt / endAt: ISO 8601 UTC "…Z". */
export interface IBooking {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  startAt: string;
  endAt: string;
  organizerEmployeeId: string;
  organizerName: string;
  note: string | null;
  attendees: IAttendee[];
  isMine: boolean;
  canCancel: boolean;
}

/** startAt / endAt: ISO 8601 KÈM múi giờ (vnInstant). */
export interface ICreateBooking {
  roomId: string;
  title: string;
  startAt: string;
  endAt: string;
  attendeeIds: string[];
  note: string | null;
}

export interface IRoomNow {
  roomId: string;
  roomName: string;
  capacity: number;
  current: IBooking | null;
  next: IBooking | null;
}
