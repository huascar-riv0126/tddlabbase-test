import restar from "./restador";

describe('Restar', () => {
  it('deberia restar dos numeros', () => {
    expect(restar(3, 2)).toEqual(1);
  });
});
