import jwt from 'jsonwebtoken';
import { promisify } from 'util';

const signAsync = promisify(jwt.sign);
const verifyAsync = promisify(jwt.verify);

export const signAccessToken = async (payload) => {
  return await signAsync(payload, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: process.env.ACCESS_TOKEN_EXPIRY || '5h',
    algorithm: 'HS256'
  });
};

export const signRefreshToken = async (payload) => {
  return await signAsync(payload, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: process.env.REFRESH_TOKEN_EXPIRY || '7d',
    algorithm: 'HS256'
  });
};

export const verifyAccessToken = async (token) => {
  return await verifyAsync(token, process.env.ACCESS_TOKEN_SECRET);
};

export const verifyRefreshToken = async (token) => {
  return await verifyAsync(token, process.env.REFRESH_TOKEN_SECRET);
};
