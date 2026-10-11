"""Render original, mathematically constructed study diagrams for the Web client."""
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Polygon

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/web/public/axisverse/diagrams'
BLUE='#3569ed'; ORANGE='#d58a19'; TEAL='#188c93'; INK='#18314d'; GRAY='#8294ac'; LIGHT='#dce7f8'
font=Path('C:/Windows/Fonts/msyh.ttc')
if font.exists():
    font_manager.fontManager.addfont(str(font))
    plt.rcParams['font.family']=font_manager.FontProperties(fname=str(font)).get_name()
plt.rcParams.update({'font.size':15,'text.color':INK,'axes.unicode_minus':False,'mathtext.fontset':'dejavusans'})


def canvas():
    return plt.figure(figsize=(8,8),dpi=160,facecolor='white')


def pane(fig, rect, xlim, ylim):
    ax=fig.add_axes(rect);ax.set(xlim=xlim,ylim=ylim,aspect='equal');ax.axis('off');return ax


def arrow(ax,a,b,color=GRAY,lw=1.7):
    ax.annotate('',xy=b,xytext=a,arrowprops={'arrowstyle':'->','color':color,'lw':lw,'mutation_scale':13})


def line(ax, points, color=INK, **kw):
    v=np.asarray(points);ax.plot(v[:,0],v[:,1],color=color,**kw)


def proj(p):
    p=np.asarray(p);return np.stack((.90*p[...,0]+.80*p[...,1],-.32*p[...,0]+.48*p[...,1]+p[...,2]),axis=-1)


def sph(r,t,p):
    r,t,p=np.broadcast_arrays(r,t,p)
    return np.stack((r*np.sin(t)*np.cos(p),r*np.sin(t)*np.sin(p),r*np.cos(t)),axis=-1)


def save(fig,name):
    OUT.mkdir(parents=True,exist_ok=True);fig.savefig(OUT/name,dpi=160,facecolor='white');plt.close(fig)


def angles():
    fig=canvas()
    ax=pane(fig,[.07,.07,.86,.86],[-.5,4.2],[-1.3,3.8])
    r=3.;t=np.deg2rad(52);p=np.deg2rad(38);P=sph(r,t,p);Q=P*np.array([1,1,0]);O=np.array([0,0])
    floor=proj(np.array([[0,0,0],[3.2,0,0],[3.2,2.4,0],[0,2.4,0]]))
    ax.add_patch(Polygon(floor,facecolor='#f1f5fd',edgecolor=LIGHT))
    for vector,label,offset in [(np.array([3.6,0,0]),'$x$',(.03,-.1)),(np.array([0,3.2,0]),'$y$',(.05,0)),(np.array([0,0,3.4]),'$z$',(-.05,.07))]:
        tip=proj(vector);arrow(ax,O,tip);ax.text(*(tip+offset),label,size=18)
    line(ax,[O,proj(P)],BLUE,lw=3);line(ax,[O,proj(Q)],ORANGE,lw=2)
    line(ax,[proj(Q),proj(P)],GRAY,ls='--',lw=1.5)
    ax.scatter(*proj(P),color=BLUE,s=55,zorder=4);ax.scatter(*proj(Q),color=ORANGE,s=36,zorder=4)
    ax.text(*(proj(P)+[.06,.06]),'$P$',size=19,color=BLUE);ax.text(*(proj(Q)+[.02,-.28]),'$Q$',size=18,color=ORANGE)
    ax.text(-.25,-.12,'O',size=17);ax.text(*(proj(P)*.59+[-.55,.35]),'$r=|OP|$',size=18,color=BLUE)
    line(ax,proj(sph(.85,np.linspace(0,t,60),p)),BLUE,lw=2.5)
    ax.text(*(proj(sph(1.10,t*.5,p))+[-.08,0]),r'$\theta$',color=BLUE,size=23)
    line(ax,proj(sph(1.02,np.pi/2,np.linspace(0,p,60))),ORANGE,lw=2.5)
    ax.text(*(proj(sph(1.23,np.pi/2,p*.5))+[.02,-.18]),r'$\varphi$',color=ORANGE,size=23)
    ax.text(2.65,-.7,'xy',size=13,color=GRAY)
    save(fig,'spherical-angles-v2.png')


def volume():
    fig=canvas()
    small=pane(fig,[.07,.07,.86,.86],[-.3,3.4],[-.3,2.6])
    A=np.array([.4,.2]);B=np.array([2.2,.2]);C2=np.array([1.05,.85]);D=np.array([.4,1.8]);shift=np.array([0,1.6])
    for points in [[A,B,B+shift,D],[A,C2,C2+shift,D],[D,B+shift,B+shift+C2-A,C2+shift]]:
        small.add_patch(Polygon(points,facecolor='#eaf1ff',edgecolor='#a7bee9',alpha=.9))
    line(small,[A,B],TEAL,lw=3);line(small,[A,D],BLUE,lw=3);line(small,[A,C2],ORANGE,lw=3)
    small.text(.95,-.14,r'$r\sin\theta\,d\varphi$',color=TEAL,size=17)
    small.text(-.16,.93,r'$dr$',color=BLUE,size=19)
    small.annotate(r'$r\,d\theta$',xy=(A+C2)*.5,xytext=(1.70,.94),fontsize=18,color=ORANGE,arrowprops={'arrowstyle':'-','color':ORANGE})
    save(fig,'spherical-volume-v2.png')


def polar():
    fig=canvas()
    ax=pane(fig,[.07,.07,.86,.86],[-.3,3.9],[-.35,3.5]);arrow(ax,[0,0],[3.65,0]);arrow(ax,[0,0],[0,3.25]);ax.text(3.5,-.25,'x');ax.text(-.24,3.1,'y');ax.text(-.2,-.2,'O')
    r=2.4;dr=.5;p=.55;dp=.26
    point=lambda rad,a: np.c_[rad*np.cos(a),rad*np.sin(a)]
    arc=point(r,np.linspace(p,p+dp,60));outer=point(r+dr,np.linspace(p+dp,p,60))
    ax.add_patch(Polygon(np.vstack((arc,outer)),facecolor='#e1ecff',edgecolor=BLUE,lw=1.5))
    for a in [p,p+dp]:line(ax,[[0,0],[(r+dr)*np.cos(a),(r+dr)*np.sin(a)]],GRAY,lw=1)
    line(ax,point(r,np.linspace(p,p+dp,60)),TEAL,lw=4)
    line(ax,point(np.array([r,r+dr]),p),BLUE,lw=4)
    ax.text(.85,.25,'ρ',size=22);line(ax,point(.65,np.linspace(0,p,40)),ORANGE,lw=2);ax.text(.68,.1,r'$\varphi$',color=ORANGE,size=20)
    ax.annotate(r'$d\rho$',xy=point(r+dr*.5,p)[0],xytext=(2.95,1.15),fontsize=22,color=BLUE,arrowprops={'arrowstyle':'-','color':BLUE})
    ax.annotate(r'$\rho\,d\varphi$',xy=point(r,p+dp*.5)[0],xytext=(.6,2.7),fontsize=22,color=TEAL,arrowprops={'arrowstyle':'-','color':TEAL})
    save(fig,'polar-area-v2.png')


if __name__=='__main__':
    angles();volume();polar()
    print(f'Rendered three diagrams in {OUT}')
