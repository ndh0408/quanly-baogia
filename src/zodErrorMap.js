// Vietnamese fallback messages for Zod (v4).
//
// Any validation rule that does NOT pass its own message argument would otherwise
// surface Zod's built-in ENGLISH text (e.g. "Too big: expected string to have <=200
// characters", "Invalid option: expected one of …") straight to end users. This map
// translates those defaults to Vietnamese. Rules that DO carry a specific message
// still win — per-rule messages take precedence over this global fallback.
//
// Installed once via `z.config({ customError })` from validators.js. Because that call
// runs in the module BODY (after imports), config.js has already parsed process.env by
// then, so boot-time env errors keep their original (operator-facing) text.
//
// Returning undefined for an unhandled code lets Zod use its own default.
export function viZodErrorMap(issue) {
  switch (issue.code) {
    case "invalid_type": {
      const exp = issue.expected;
      if (exp === "int") return "Phải là số nguyên";
      if (exp === "number" || exp === "bigint") return "Phải là số";
      if (exp === "date") return "Ngày/giờ không hợp lệ";
      if (exp === "boolean") return "Giá trị không hợp lệ";
      if (exp === "array") return "Danh sách không hợp lệ";
      if (exp === "object") return "Dữ liệu không hợp lệ";
      return "Vui lòng nhập giá trị hợp lệ";
    }
    case "too_small": {
      const n = issue.minimum;
      switch (issue.origin) {
        case "string": return `Tối thiểu ${n} ký tự`;
        case "array":
        case "set": return `Cần ít nhất ${n} mục`;
        case "number":
        case "bigint": return issue.inclusive ? `Không được nhỏ hơn ${n}` : `Phải lớn hơn ${n}`;
        case "date": return "Thời gian quá sớm";
        default: return "Giá trị quá nhỏ";
      }
    }
    case "too_big": {
      const n = issue.maximum;
      switch (issue.origin) {
        case "string": return `Tối đa ${n} ký tự`;
        case "array":
        case "set": return `Tối đa ${n} mục`;
        case "number":
        case "bigint": return issue.inclusive ? `Không được lớn hơn ${n}` : `Phải nhỏ hơn ${n}`;
        case "date": return "Thời gian quá muộn";
        default: return "Giá trị quá lớn";
      }
    }
    case "invalid_format": {
      switch (issue.format) {
        case "email": return "Email không hợp lệ";
        case "url": return "Địa chỉ URL không hợp lệ";
        case "uuid":
        case "cuid":
        case "cuid2":
        case "nanoid":
        case "ulid": return "Mã định danh không hợp lệ";
        case "datetime":
        case "date":
        case "time": return "Định dạng thời gian không hợp lệ";
        default: return "Định dạng không hợp lệ";
      }
    }
    case "invalid_value":       // enum / literal
      return "Giá trị không hợp lệ";
    case "not_multiple_of":
      return "Giá trị không hợp lệ";
    case "unrecognized_keys":
      return "Có trường dữ liệu không hợp lệ";
    case "invalid_key":
      return "Khóa dữ liệu không hợp lệ";
    case "invalid_element":
      return "Phần tử trong danh sách không hợp lệ";
    case "invalid_union":
      return "Dữ liệu không hợp lệ";
    default:
      return undefined; // let Zod use its built-in message for anything unhandled
  }
}
