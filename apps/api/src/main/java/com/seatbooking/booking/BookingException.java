package com.seatbooking.booking;

import org.springframework.http.HttpStatus;

/** A booking refused for a reason worth showing the person who asked. */
public class BookingException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public BookingException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }
}
