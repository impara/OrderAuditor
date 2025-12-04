import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "./logger";

describe("Logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should log info messages", () => {
    const consoleSpy = vi.spyOn(console, "log");
    logger.info("test message");
    expect(consoleSpy).toHaveBeenCalled();
    
    // Get all arguments of the first call
    const callArgs = consoleSpy.mock.calls[0];
    const joinedArgs = callArgs.join(" ");
    
    // Check if it contains the message or is a JSON string containing the message
    if (process.env.NODE_ENV === 'production') {
        expect(joinedArgs).toContain('"level":"info"');
        expect(joinedArgs).toContain('"message":"test message"');
    } else {
        expect(joinedArgs).toContain("[INFO]");
        expect(joinedArgs).toContain("test message");
    }
  });

  it("should log error messages", () => {
    const consoleSpy = vi.spyOn(console, "error");
    logger.error("error message");
    expect(consoleSpy).toHaveBeenCalled();
  });
});
