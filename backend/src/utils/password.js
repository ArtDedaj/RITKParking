import bcrypt from "bcryptjs";

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password, passwordHash) {
  return bcrypt.compareSync(password, passwordHash);
}
